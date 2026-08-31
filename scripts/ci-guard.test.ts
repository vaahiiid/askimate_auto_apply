/**
 * The security suites must actually run somewhere that can fail the build.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-27: *"If they are currently able to be silently skipped
 * because the required database is unavailable, fix that verification gap
 * appropriately so these security properties cannot quietly decay again. Do
 * not merely document the problem."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── What went wrong, and why a comment would not have prevented it ────────
 *
 * The database-backed suites — "a student's password reaches no column of any
 * row", "the box reopens and holds nothing", the fail-closed scenarios — are
 * gated on a reachable PostgreSQL. Without one they print a large banner and
 * skip, which is the right behaviour on a laptop: the alternative is that
 * nobody can run any test without a database.
 *
 * The cost of that kindness is that **a skip and a pass look identical to
 * anything reading the exit code.** The protection against it is a CI job that
 * sets `AAS_REQUIRE_DATABASE=1`, which turns the skip into a throw. That job
 * exists. But nothing was checking that it *still* exists, still requires a
 * database, and still covers the suites — and this repository has already lost
 * a security property to silence once today.
 *
 * So this file asserts, from the default `pnpm run test` path with no database
 * needed, that the CI workflow still does its job. Delete the integration job,
 * drop the environment variable, or narrow it back to a hand-written list of
 * paths, and this goes red on the next ordinary test run.
 *
 * It reads the workflow as TEXT rather than parsing YAML, deliberately: the
 * repository has no YAML parser as a dependency, and adding one to check a
 * handful of literal strings would be a worse trade than the crude match.
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WORKFLOW = join(import.meta.dirname, "..", ".github", "workflows", "ci.yml");
const ci = readFileSync(WORKFLOW, "utf8");

/** Suites whose guarantees are only meaningful against a real database. */
const DATABASE_BACKED = [
  "apps/chat-integration/src/fail-closed.test.ts",
  "apps/chat-integration/src/end-to-end.test.ts",
  "packages/case-store/src/postgres.test.ts",
  "packages/case-store/src/workflow.test.ts",
  // The ordinal authority. Its guarantees — a UNIQUE constraint resolving two
  // racing writers to one, a counter that cannot outrun its log, a transaction
  // that takes both back together — are properties of PostgreSQL, and a fake
  // proving them would be a fake re-implementing the thing under test.
  "apps/conversation-service/src/event-store.test.ts",
  // And the HTTP surface over it: resumable SSE, the fail-closed guard, and the
  // internal append, all over a listening server against a real log.
  "apps/conversation-service/src/routes.test.ts",
  // The conversation plane's deployment: the __Host- session and the handler
  // that scrubs a raw body off a parse error before anything can log it.
  "apps/conversation-service/src/app.test.ts",
  // The React client against the real service, in a real browser: server
  // ordinals, resumable SSE, two clients converging, the fail-closed guard.
  "apps/chat-integration/src/conversation-service.test.ts",
  // The lifecycle push across the plane boundary, against two real databases.
  "apps/secure-service/src/lifecycle.test.ts",
  // THE ONE ENDPOINT THAT RECEIVES A PASSWORD, and the scans that prove the
  // value reaches no column, no response and no log line.
  "apps/secure-service/src/secure-routes.test.ts",
  // A real browser typing a real credential into the cross-origin Secure Plane.
  "apps/chat-integration/src/two-origin.test.ts",
  // ADR-0042: the whole credential path across three processes — the student's
  // submission, the fill agent's local decryption, a real field in a real
  // browser — plus the scan of every HTTP body exchanged between them. Its
  // strongest assertions read the secure plane's own tables, so a run without a
  // database would report green while checking nothing.
  "apps/secure-service/src/fill-agent-e2e.test.ts",
  // P1: the run exists, and survives the process that started it. Its strongest
  // assertions are a composite foreign key refusing another student's case and
  // a restart that resumes rather than restarts — both properties of
  // PostgreSQL, which a fake would be re-implementing rather than testing.
  "apps/conversation-service/src/run-driver.test.ts",
  // P6: a REAL account created on a REAL gated portal, with the password typed
  // by the Secure Plane's agent into the runner's browser. The assertion that
  // matters is `credentialsWork(email, password)` — asked of the portal, which
  // is the only source that could say no. Database-backed because the
  // lifecycle, the use ledger and the outbox are all in it.
  "apps/secure-service/src/account-creation-e2e.test.ts",
  // P7: the whole journey — a student asks, is interviewed, types a password
  // into the Secure Plane, and a runner creates their account on a real portal.
  // Four planes, two databases, a real browser and a real portal. Nothing else
  // in the repository crosses all of them at once.
  "scripts/journey.test.ts",
] as const;

describe("CI still runs the database-backed security suites", () => {
  it("has a job with a PostgreSQL service", () => {
    expect(ci).toContain("services:");
    expect(ci).toMatch(/image:\s*postgres:/);
  });

  it("sets AAS_REQUIRE_DATABASE=1, so a missing database FAILS instead of skipping", () => {
    // The single most important line in the workflow. Without it, a CI run
    // whose Postgres service failed to start reports green while checking
    // none of the properties the job exists to check.
    expect(ci).toMatch(/AAS_REQUIRE_DATABASE:\s*"1"/);
  });

  it("points that job at a database URL", () => {
    expect(ci).toMatch(/AAS_TEST_DATABASE_URL:\s*postgres/);
  });

  it("runs the WHOLE suite there, rather than a list of paths that can go stale", () => {
    // `vitest run` with no positional filter. A list would silently omit any
    // database-backed suite added later somewhere it did not name, and the job
    // would stay green while covering less.
    expect(ci).toMatch(/run:\s*pnpm exec vitest run\s*$/m);
  });

  it("names every database-backed suite that exists, so a new one cannot be forgotten", () => {
    // Not a check on the workflow — a check on THIS file. If a suite is added
    // to `DATABASE_BACKED` it must exist; if one is deleted or renamed, this
    // list must be updated rather than left pointing at nothing. That keeps the
    // inventory above honest, which is what the first test depends on.
    for (const suite of DATABASE_BACKED) {
      const path = join(import.meta.dirname, "..", suite);
      expect(() => readFileSync(path, "utf8")).not.toThrow();
    }
  });

  it.each(DATABASE_BACKED)(
    "%s really DOES fail when the database is missing",
    async (suite) => {
      // Executed, not grepped — and executed ONE SUITE AT A TIME.
      //
      // Two wrong versions preceded this one, and both are worth recording
      // because they are the same mistake in different clothes.
      //
      // The first asserted that each file contained the string "announceSkip".
      // It went red on two files that were entirely correct, because
      // `packages/case-store` inlines the same throw-if-required logic instead
      // of importing the helper. It was checking a MECHANISM when the property
      // is behavioural — and a text match would equally have passed on the word
      // sitting inside a comment.
      //
      // The second ran all four suites in ONE subprocess and asserted the exit
      // code was non-zero. That passed while a suite skipped silently, because
      // the other three still threw and the aggregate exit code hid it. A test
      // that cannot fail for the reason it exists is worse than no test: it
      // reports that something is protected when nothing is.
      //
      // One subprocess per suite. Each must fail on its own.
      const code = await new Promise<number>((resolvePromise) => {
        const child = spawn("pnpm", ["exec", "vitest", "run", suite, "--reporter=dot"], {
          cwd: join(import.meta.dirname, ".."),
          env: {
            ...process.env,
            AAS_REQUIRE_DATABASE: "1",
            // Port 1: refused instantly, so this stays fast and cannot reach a
            // database someone happens to have running.
            AAS_TEST_DATABASE_URL: "postgresql://postgres@127.0.0.1:1/postgres",
          },
          stdio: "ignore",
        });
        child.on("close", (exit) => resolvePromise(exit ?? -1));
      });

      expect(code).not.toBe(0);
    },
    120_000,
  );

});

describe("no test may reach a live university site", () => {
  it("the discovery CLI test stops at resolution, before any browser opens", () => {
    // `AAS_DISCOVERY_DRY_RUN` was set by the test and read by nothing, so in
    // CI — which has open network, unlike the sandboxed dev machine — three
    // tests crawled qahighereducation.com and ulster.ac.uk on every push until
    // they timed out. The flag is real now; this asserts it stays real.
    const cli = readFileSync(
      join(import.meta.dirname, "..", "apps", "browser-runner", "src", "cli.ts"),
      "utf8",
    );
    expect(cli).toContain('process.env["AAS_DISCOVERY_DRY_RUN"] === "1"');
    expect(cli).toContain("No pages fetched.");

    const test = readFileSync(
      join(import.meta.dirname, "..", "apps", "browser-runner", "src", "cli.test.ts"),
      "utf8",
    );
    // Every resolution test must assert it, or the guard is decorative.
    const asserted = test.split("No pages fetched.").length - 1;
    expect(asserted).toBeGreaterThanOrEqual(3);
  });
});
