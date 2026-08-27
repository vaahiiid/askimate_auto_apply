/**
 * Phase 4: the three crash windows, and the action that must never repeat.
 *
 * Every test here kills the process at a specific point and asks what the next
 * run does. "Killing the process" is modelled as: stop calling this function,
 * construct a fresh store connection, and call it again knowing only what was
 * durably written — which is exactly what a restart has.
 *
 * The end-to-end version, against real PostgreSQL with genuinely separate
 * connection pools, is at the bottom.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import { caseId as makeCaseId, beginCheckpoint, blueprintVersion, runId as makeRunId, studentId } from "@askimate/aas-domain";
import type { ActionIntent, RunId } from "@askimate/aas-domain";
import { InMemoryWorkflowRunStore } from "@askimate/aas-case-store";
import type { WorkflowRunStore } from "@askimate/aas-case-store/workflow";
import { PostgresWorkflowRunStore } from "@askimate/aas-case-store/postgres-workflow";
import { migrate } from "@askimate/aas-case-store/migrate";

import { performOnce, recordCleanFailure } from "./consequential.js";
import type { VerificationResult } from "./consequential.js";

const DATABASE_URL =
  process.env["AAS_TEST_DATABASE_URL"] ?? "postgresql://postgres@localhost:55432/postgres";
const DATABASE_REQUIRED = process.env["AAS_REQUIRE_DATABASE"] === "1";

const NOW = new Date("2026-08-27T10:00:00Z");
const VERSION = blueprintVersion("ulster-msc-ib-v3");
const STUDENT = studentId("stu_001");
const CASE = makeCaseId("case_conseq");
const HOST = "apply.example.ac.uk";

async function withRun(store: WorkflowRunStore, id: RunId): Promise<RunId> {
  await store.start({
    runId: id,
    caseId: CASE,
    studentRef: STUDENT,
    status: "running",
    checkpoint: beginCheckpoint({ blueprintVersion: VERSION, now: NOW }),
    startedAt: NOW,
  });
  return id;
}

/** Counts how many times the consequential thing actually ran. */
function counter(): { run: () => Promise<string>; count: () => number } {
  let calls = 0;
  return {
    run: async () => {
      calls += 1;
      await Promise.resolve();
      return `performed_${String(calls)}`;
    },
    count: () => calls,
  };
}

const verifier = (result: VerificationResult) => async (_intent: ActionIntent) => {
  await Promise.resolve();
  return result;
};

// ───────────────────────────────────────────────────────────────────────────
// The happy path, and the three windows
// ───────────────────────────────────────────────────────────────────────────

describe("performing a consequential action", () => {
  it("performs it once and records the intent BEFORE acting", async () => {
    // The ordering IS the mechanism. If the record came after, a crash during
    // the action would leave nothing to detect.
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_1"));
    const account = counter();

    const order: string[] = [];
    // A delegating wrapper, not `{ ...store }` — spreading a class instance
    // drops every prototype method, so the spread version had no `findIntent`
    // at all and failed for a reason that had nothing to do with the ordering
    // under test.
    const observed: WorkflowRunStore = {
      start: (run) => store.start(run),
      load: (runId) => store.load(runId),
      saveCheckpoint: (save) => store.saveCheckpoint(save),
      recordIntent: async (runId, intent) => {
        order.push("intent");
        return store.recordIntent(runId, intent);
      },
      completeIntent: (runId, key, outcome, at) =>
        store.completeIntent(runId, key, outcome, at),
      findIntent: (runId, key) => store.findIntent(runId, key),
      findByCase: (caseId) => store.findByCase(caseId),
      discardCheckpoints: (runId) => store.discardCheckpoints(runId),
    };

    const outcome = await performOnce({
      store: observed,
      runId: id,
      action: "create_portal_account",
      target: HOST,
      now: () => NOW,
      perform: async () => {
        order.push("act");
        return account.run();
      },
      verify: verifier({ kind: "did_not_happen" }),
    });

    expect(outcome.kind).toBe("performed");
    expect(account.count()).toBe(1);
    expect(order).toEqual(["intent", "act"]);
  });

  it("(a) crash BEFORE the action: the next run performs it, once", async () => {
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_a"));
    const account = counter();

    // Nothing was recorded, because the crash happened first. The next run
    // finds no intent at all.
    const outcome = await performOnce({
      store,
      runId: id,
      action: "create_portal_account",
      target: HOST,
      now: () => NOW,
      perform: account.run,
      verify: verifier({ kind: "did_not_happen" }),
    });
    expect(outcome.kind).toBe("performed");
    expect(account.count()).toBe(1);
  });

  it("(b/c) crash DURING, verifier says it DID happen: does NOT repeat", async () => {
    // The account exists. Running again would create a second one.
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_b"));
    await store.recordIntent(id, {
      idempotencyKey: `${id}:create_portal_account:${HOST}` as never,
      action: "create_portal_account",
      target: HOST,
      startedAt: NOW,
    });
    const account = counter();

    const outcome = await performOnce({
      store,
      runId: id,
      action: "create_portal_account",
      target: HOST,
      now: () => NOW,
      perform: account.run,
      verify: verifier({ kind: "already_happened" }),
    });

    expect(outcome.kind).toBe("confirmed_already_happened");
    expect(account.count()).toBe(0);
    // And the record is reconciled, so the NEXT resume needs no verification.
    const found = await store.findIntent(id, `${id}:create_portal_account:${HOST}` as never);
    expect(found?.completed?.outcome).toBe("succeeded");
  });

  it("(b/c) crash DURING, verifier says it did NOT happen: performs it, once", async () => {
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_c"));
    await store.recordIntent(id, {
      idempotencyKey: `${id}:create_portal_account:${HOST}` as never,
      action: "create_portal_account",
      target: HOST,
      startedAt: NOW,
    });
    const account = counter();

    const outcome = await performOnce({
      store,
      runId: id,
      action: "create_portal_account",
      target: HOST,
      now: () => NOW,
      perform: account.run,
      verify: verifier({ kind: "did_not_happen" }),
    });
    expect(outcome.kind).toBe("performed");
    expect(account.count()).toBe(1);
  });

  it("crash DURING, verifier CANNOT TELL: escalates, does not act", async () => {
    // ── The tempting simplification, refused ────────────────────────────
    //
    // "unknown_still" must never be collapsed into "did not happen". That
    // collapse is exactly what creates a second university account for a
    // student who already has one.
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_d"));
    await store.recordIntent(id, {
      idempotencyKey: `${id}:create_portal_account:${HOST}` as never,
      action: "create_portal_account",
      target: HOST,
      startedAt: NOW,
    });
    const account = counter();

    const outcome = await performOnce({
      store,
      runId: id,
      action: "create_portal_account",
      target: HOST,
      now: () => NOW,
      perform: account.run,
      verify: verifier({ kind: "unknown_still", detail: "the portal returned 503" }),
    });

    expect(outcome.kind).toBe("escalate");
    expect(account.count()).toBe(0);
    if (outcome.kind !== "escalate") return;
    expect(outcome.why).toContain("503");
    expect(outcome.why).toContain("specialist");
  });

  it("crash DURING an UNVERIFIABLE action: escalates, and never acts", async () => {
    // A spent secret handle leaves nothing to look at. The store destroyed it
    // and the portal cannot say whether the password it received came from us.
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_e"));
    await store.recordIntent(id, {
      idempotencyKey: `${id}:consume_secret:${HOST}` as never,
      action: "consume_secret",
      target: HOST,
      startedAt: NOW,
    });
    const secret = counter();

    const outcome = await performOnce({
      store,
      runId: id,
      action: "consume_secret",
      target: HOST,
      now: () => NOW,
      perform: secret.run,
      // Even an optimistic verifier cannot make an unverifiable action
      // verifiable — `isVerifiable` is data in the domain precisely so this is
      // not a judgement made in the moment.
      verify: verifier({ kind: "did_not_happen" }),
    });

    expect(outcome.kind).toBe("escalate");
    expect(secret.count()).toBe(0);
  });

  it("a verifiable action with NO verifier escalates rather than guessing", async () => {
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_f"));
    await store.recordIntent(id, {
      idempotencyKey: `${id}:attach_document:doc_1` as never,
      action: "attach_document",
      target: "doc_1",
      startedAt: NOW,
    });
    const attach = counter();

    const outcome = await performOnce({
      store,
      runId: id,
      action: "attach_document",
      target: "doc_1",
      now: () => NOW,
      perform: attach.run,
    });
    expect(outcome.kind).toBe("escalate");
    expect(attach.count()).toBe(0);
  });

  it("does not repeat an action recorded as FAILED CLEANLY", async () => {
    // A failed_cleanly action still ran. Running it again is a second attempt
    // nobody decided to make.
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_g"));
    await store.recordIntent(id, {
      idempotencyKey: `${id}:advance_portal_page:${HOST}` as never,
      action: "advance_portal_page",
      target: HOST,
      startedAt: NOW,
    });
    await recordCleanFailure({
      store,
      runId: id,
      action: "advance_portal_page",
      target: HOST,
      now: NOW,
    });
    const advance = counter();

    const outcome = await performOnce({
      store,
      runId: id,
      action: "advance_portal_page",
      target: HOST,
      now: () => NOW,
      perform: advance.run,
      verify: verifier({ kind: "did_not_happen" }),
    });
    expect(outcome.kind).toBe("already_done");
    expect(advance.count()).toBe(0);
  });

  it("NEVER performs an action twice, across every crash window", async () => {
    // The property, checked by enumeration rather than by inspecting branches.
    //
    // ── Why this starts from an UNCERTAIN state ─────────────────────────
    //
    // The first version started from a clean run: perform once, then retry
    // five times. Every retry hit `already_done` and returned immediately, so
    // the verify branch was never exercised at all — and the regression that
    // collapses `unknown_still` into "did not happen", which is THE duplicate
    // bug this phase exists to prevent, was caught by exactly one other test.
    //
    // So each case here begins where a crash actually leaves things: an intent
    // written, no completion. That is the state in which a wrong answer
    // creates a second university account.
    for (const verification of [
      { kind: "already_happened" } as const,
      { kind: "unknown_still", detail: "the portal returned 503" } as const,
    ]) {
      const store = new InMemoryWorkflowRunStore();
      const id = await withRun(store, makeRunId(`run_never_${verification.kind}`));
      const account = counter();

      // The crash: intent recorded, action may or may not have reached the
      // portal, nothing recorded as finished.
      await store.recordIntent(id, {
        idempotencyKey: `${id}:create_portal_account:${HOST}` as never,
        action: "create_portal_account",
        target: HOST,
        startedAt: NOW,
      });

      // Five restarts, all finding the same uncertainty.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const outcome = await performOnce({
          store,
          runId: id,
          action: "create_portal_account",
          target: HOST,
          now: () => NOW,
          perform: account.run,
          verify: verifier(verification),
        });
        // Whatever it decides, it must never be "I performed it".
        expect(outcome.kind, `${verification.kind} attempt ${String(attempt)}`).not.toBe(
          "performed",
        );
      }

      // Zero, not one: the action was already attempted before the crash, and
      // nothing here may attempt it again.
      expect(account.count(), verification.kind).toBe(0);
    }
  });

  it("performs exactly once when the verifier says it did NOT happen, however many restarts", async () => {
    // The other half, so the test above cannot pass by refusing everything.
    const store = new InMemoryWorkflowRunStore();
    const id = await withRun(store, makeRunId("run_exactly_once"));
    const account = counter();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await performOnce({
        store,
        runId: id,
        action: "create_portal_account",
        target: HOST,
        now: () => NOW,
        perform: account.run,
        verify: verifier({ kind: "did_not_happen" }),
      });
    }
    expect(account.count()).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// End to end, across a real process restart
// ───────────────────────────────────────────────────────────────────────────

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DATABASE_URL, connectionTimeoutMillis: 2_000 });
  try {
    await probe.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}

const HAVE_DATABASE = await reachable();
if (!HAVE_DATABASE) {
  const banner =
    `\n${"█".repeat(78)}\n` +
    `██  NOT CHECKED: consequential-action safety across a real process restart\n` +
    `██\n` +
    `██  No PostgreSQL at ${DATABASE_URL}\n` +
    `██  "A portal account is never created twice" did NOT run.\n` +
    `██\n` +
    `██  To run it:   pnpm run verify:integration\n` +
    `${"█".repeat(78)}\n`;
  if (DATABASE_REQUIRED) throw new Error(banner);
  console.warn(banner);
}

const describeIfDatabase = HAVE_DATABASE ? describe : describe.skip;

let admin: pg.Pool;

beforeAll(async () => {
  if (!HAVE_DATABASE) return;
  const root = new pg.Pool({ connectionString: DATABASE_URL });
  try {
    await root.query("DROP DATABASE IF EXISTS aas_consequential WITH (FORCE)");
    await root.query("CREATE DATABASE aas_consequential");
  } finally {
    await root.end();
  }
  const url = new URL(DATABASE_URL);
  url.pathname = "/aas_consequential";
  admin = new pg.Pool({ connectionString: url.toString() });
  await migrate(admin);
}, 120_000);

afterAll(async () => {
  if (HAVE_DATABASE) await admin.end();
});

function newProcess(): { pool: pg.Pool; store: WorkflowRunStore } {
  const url = new URL(DATABASE_URL);
  url.pathname = "/aas_consequential";
  const pool = new pg.Pool({ connectionString: url.toString() });
  return { pool, store: new PostgresWorkflowRunStore(pool) };
}

describeIfDatabase("across a genuine process restart", () => {
  it("a portal account is NEVER created twice, whatever the verifier says", async () => {
    // ── The demonstration ───────────────────────────────────────────────
    //
    // Process A records the intent and then DIES mid-action — the account may
    // or may not exist on the portal. Process B, with its own pool and no
    // memory of anything, must not create a second one.
    await admin.query("TRUNCATE workflow_action_intents, workflow_runs");
    const id = makeRunId("run_restart_account");
    let creations = 0;

    const processA = newProcess();
    try {
      await withRun(processA.store, id);
      // Intent written; the action then "runs" and the process dies before any
      // completion can be recorded. This is windows (b) and (c) at once, and
      // they are indistinguishable from here.
      await processA.store.recordIntent(id, {
        idempotencyKey: `${id}:create_portal_account:${HOST}` as never,
        action: "create_portal_account",
        target: HOST,
        startedAt: NOW,
      });
      creations += 1; // it reached the portal
    } finally {
      await processA.pool.end();
    }

    // Process B: the portal says the account exists.
    const processB = newProcess();
    try {
      const outcome = await performOnce({
        store: processB.store,
        runId: id,
        action: "create_portal_account",
        target: HOST,
        now: () => NOW,
        perform: async () => {
          creations += 1;
          await Promise.resolve();
          return "created";
        },
        verify: verifier({ kind: "already_happened" }),
      });
      expect(outcome.kind).toBe("confirmed_already_happened");
    } finally {
      await processB.pool.end();
    }

    // Process C: tries again, and finds the reconciled record.
    const processC = newProcess();
    try {
      const outcome = await performOnce({
        store: processC.store,
        runId: id,
        action: "create_portal_account",
        target: HOST,
        now: () => NOW,
        perform: async () => {
          creations += 1;
          await Promise.resolve();
          return "created";
        },
        verify: verifier({ kind: "did_not_happen" }),
      });
      expect(outcome.kind).toBe("already_done");
    } finally {
      await processC.pool.end();
    }

    // Exactly one account, across three processes.
    expect(creations).toBe(1);
  }, 120_000);

  it("an unverifiable action escalates across a restart, and never runs twice", async () => {
    await admin.query("TRUNCATE workflow_action_intents, workflow_runs");
    const id = makeRunId("run_restart_secret");
    let spends = 0;

    const processA = newProcess();
    try {
      await withRun(processA.store, id);
      await processA.store.recordIntent(id, {
        idempotencyKey: `${id}:consume_secret:${HOST}` as never,
        action: "consume_secret",
        target: HOST,
        startedAt: NOW,
      });
      spends += 1;
    } finally {
      await processA.pool.end();
    }

    const processB = newProcess();
    try {
      const outcome = await performOnce({
        store: processB.store,
        runId: id,
        action: "consume_secret",
        target: HOST,
        now: () => NOW,
        perform: async () => {
          spends += 1;
          await Promise.resolve();
          return "spent";
        },
      });
      expect(outcome.kind).toBe("escalate");
      if (outcome.kind !== "escalate") return;
      expect(outcome.action).toBe("consume_secret");
      expect(outcome.target).toBe(HOST);
    } finally {
      await processB.pool.end();
    }

    expect(spends).toBe(1);
  }, 120_000);
});
