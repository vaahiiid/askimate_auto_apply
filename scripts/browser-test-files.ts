/**
 * The test files that launch a real Chromium.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS LIST EXISTS, AND WHY IT IS NOT ALLOWED TO GO STALE.
 *
 * Measured on 2026-09-08, on the four-CPU container this suite runs in: a full
 * run peaked at **21 concurrent Chromium processes** and a load average of
 * **3.97**. Vitest schedules test FILES across workers, and a browser file
 * launches a browser that is itself five or six processes — so three or four
 * of these landing together saturates the machine.
 *
 * The symptom was not a crash. It was a page that took longer than a
 * twenty-second poll to process an input event, on a different test each time:
 * two full-suite runs in five failed, each on a browser test, each of which
 * passed 4/4 in isolation. `two-origin.test.ts` had already diagnosed the
 * shape in its own comments — *"the page is STARVED: several Chromium
 * instances run in parallel across this directory's suites"* — and fixed one
 * instance of it by retrying an input.
 *
 * That fix was right for that test and wrong as a strategy. Vahid, 2026-09-08:
 * *"a suite that goes red for reasons that turn out not to matter teaches
 * everyone to discount red, and the cost lands on the day a real failure
 * arrives and gets waved through. Fix the contention rather than the
 * assertions."*
 *
 * So these files run in a lane of their own, ONE AT A TIME, while everything
 * else stays parallel. They sum to 87 seconds of the suite's 242, so the lane
 * is not the critical path.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `browser-lane.test.ts` asserts this list is exactly the set of test files
 * that launch a browser, in BOTH directions — a file that starts launching one
 * and is not added here would silently rejoin the contention, and an entry
 * that no longer launches one would serialise a file for nothing.
 */
export const BROWSER_TEST_FILES: readonly string[] = [
  "apps/browser-runner/src/discovery.test.ts",
  "apps/browser-runner/src/fixture-portal.test.ts",
  "apps/browser-runner/src/inspection.test.ts",
  "apps/browser-runner/src/lwc-observe.test.ts",
  "apps/browser-runner/src/lwc-shadow.test.ts",
  "apps/browser-runner/src/preparation.test.ts",
  "apps/browser-runner/src/secret-fill.test.ts",
  "apps/browser-runner/src/sensitive.test.ts",
  "apps/chat-integration/src/conversation-service.test.ts",
  "apps/chat-integration/src/end-to-end.test.ts",
  "apps/chat-integration/src/fail-closed.test.ts",
  "apps/chat-integration/src/two-origin.test.ts",
  "apps/conversation-service/src/student-client.test.ts",
  "apps/secure-filler/src/fill.test.ts",
  "apps/secure-service/src/account-creation-e2e.test.ts",
  "apps/secure-service/src/fill-agent-e2e.test.ts",
  "scripts/journey.test.ts",
];
