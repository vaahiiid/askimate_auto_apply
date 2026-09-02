/**
 * The Automation Runner's supervisor (ADR-0052 §12, ADR-0045).
 *
 * Against a controlled intake rather than a real HTTP server, deliberately.
 * `work-intake.test.ts` already proves the HTTP facts — that 204 means "nothing
 * to do", that a refused report is not retried into a loop, that the service
 * certificate is on every request — against a real `node:http`. What is left to
 * prove here is the LOOP: that it does not overlap itself, that it survives a
 * turn going wrong, that stopping waits for a browser mid-action, and that it
 * has no opinion of its own about what may be worked on.
 *
 * The last of those is the one worth stating. Every stop condition — a
 * cancelled case (ADR-0053), an `uncertain` or `escalated` run (ADR-0048), a
 * run another runner holds (ADR-0045), an action that may already have happened
 * (ADR-0008) — is enforced on the OTHER side of the intake. The supervisor
 * inherits all of them by performing only what it is handed, and a test that
 * re-checked them here would be asserting a second opinion this loop must never
 * have.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClaimedWork, WorkReport } from "@askimate/aas-contracts";

import { startRunnerSupervisor } from "./supervisor.js";
import type { WorkIntake, PerformOutcome } from "./work-intake.js";

const WORK: ClaimedWork = {
  leaseId: "wl_1",
  expiresAt: "2026-09-02T10:02:00.000Z",
  runId: "run_case_1_1",
  caseId: "case_1",
  studentRef: "11111111-1111-1111-1111-111111111111",
  kind: "create_account",
  portalHost: "gated.portal.test",
  email: "niloofar@example.test",
  approach: "student_chosen",
  secretHandle: `sh_${"b".repeat(32)}`,
  registration: {
    url: "https://gated.portal.test/register",
    emailLocator: { strategy: "label", value: "Email address" },
    passwordLocators: [{ strategy: "name", value: "password" }],
    submitLocator: { strategy: "role", value: "button:Create account" },
  },
};

/** An intake whose every answer this test decides. */
function intakeOf(
  input: {
    /** One entry per claim, in order. `null` is a poll that found nothing. */
    readonly offers?: readonly (ClaimedWork | null)[];
    readonly accept?: boolean;
    readonly claimThrows?: boolean;
  } = {},
): WorkIntake & { readonly claims: number; readonly reports: WorkReport[] } {
  const offers = [...(input.offers ?? [])];
  const reports: WorkReport[] = [];
  let claims = 0;
  return {
    get claims(): number {
      return claims;
    },
    reports,
    claim: (): Promise<ClaimedWork | null> => {
      claims += 1;
      if (input.claimThrows === true) return Promise.reject(new Error("the plane is confused"));
      return Promise.resolve(offers.length > 0 ? (offers.shift() ?? null) : null);
    },
    report: (_runId, report): Promise<boolean> => {
      reports.push(report);
      return Promise.resolve(input.accept ?? true);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("one turn at a time", () => {
  it("claims, performs and reports", async () => {
    const intake = intakeOf({ offers: [WORK] });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
    });
    try {
      const turn = await supervisor.runOnce();
      expect(turn.kind).toBe("worked");
      expect(intake.reports).toEqual([{ leaseId: "wl_1", outcome: "succeeded" }]);
    } finally {
      await supervisor.stop();
    }
  });

  it("is idle, and quiet, when the pool has nothing", async () => {
    const intake = intakeOf();
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.reject(new Error("must not be called")),
    });
    try {
      expect(await supervisor.runOnce()).toEqual({ kind: "idle" });
      expect(intake.reports, "nothing to report").toHaveLength(0);
    } finally {
      await supervisor.stop();
    }
  });

  it("reports a THROWN performer as uncertain, and keeps going", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // `runOneTurn` owns this conversion and it matters: a thrown error means
    // this process does not know what the browser managed to do before it
    // stopped, and `uncertain` is the only honest word. Asserted here too,
    // because the LOOP must not die of it — a runner that stopped polling
    // after one bad page would never come back and nothing would notice.
    // ═══════════════════════════════════════════════════════════════════
    const intake = intakeOf({ offers: [WORK, WORK] });
    let attempts = 0;
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => {
        attempts += 1;
        if (attempts === 1) throw new Error("the page went away");
        return Promise.resolve({ kind: "succeeded" });
      },
    });
    try {
      const first = await supervisor.runOnce();
      expect(first.kind).toBe("worked");
      expect(intake.reports[0]).toEqual({
        leaseId: "wl_1",
        outcome: "uncertain",
        failure: "runner_fault",
      });

      const second = await supervisor.runOnce();
      expect(second.kind, "the loop survived it").toBe("worked");
      expect(intake.reports[1]?.outcome).toBe("succeeded");
    } finally {
      await supervisor.stop();
    }
  });

  it("does not retry a REFUSED report", async () => {
    // A refused report means this lease is no longer held — another runner took
    // it over while this one worked. Hurrying back would race the runner that
    // now owns it, so the turn ends and the loop waits.
    const intake = intakeOf({ offers: [WORK], accept: false });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
    });
    try {
      expect(await supervisor.runOnce()).toEqual({
        kind: "report_refused",
        runId: "run_case_1_1",
      });
      expect(intake.reports, "reported once, not retried").toHaveLength(1);
    } finally {
      await supervisor.stop();
    }
  });
});

describe("the loop", () => {
  it("polls again on its own, with nobody asking", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // THE POINT OF THE PHASE. `runOneTurn` has been complete since P5 and
    // nothing has ever looped it — it was the last of the six pieces of
    // machinery ADR-0052 found with no production caller.
    // ═══════════════════════════════════════════════════════════════════
    vi.useFakeTimers();
    const intake = intakeOf();
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
      idleIntervalMs: 1_000,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(intake.claims, "one poll immediately").toBe(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(intake.claims, "and again on its own").toBe(2);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(intake.claims, "and keeps going").toBe(5);
    } finally {
      await supervisor.stop();
    }
  });

  it("comes back PROMPTLY after work and waits after nothing", async () => {
    // Work arrives in runs: a multi-page application hands out one page per
    // claim, so a successful turn is strong evidence the next is already
    // waiting. An idle poll is evidence of the opposite.
    vi.useFakeTimers();
    const intake = intakeOf({ offers: [WORK] });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
      idleIntervalMs: 10_000,
      busyIntervalMs: 100,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(intake.claims).toBe(1);

      // The first turn worked, so the next comes at the BUSY interval.
      await vi.advanceTimersByTimeAsync(100);
      expect(intake.claims, "prompt after work").toBe(2);

      // That one found nothing, so the next waits the idle interval.
      await vi.advanceTimersByTimeAsync(100);
      expect(intake.claims, "not prompt after nothing").toBe(2);
      await vi.advanceTimersByTimeAsync(9_900);
      expect(intake.claims, "patient after nothing").toBe(3);
    } finally {
      await supervisor.stop();
    }
  });

  it("does NOT hurry back after a report the plane REFUSED", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // A refused report means the lease was taken over while this runner held
    // it: it was slow, the lease lapsed, and somebody else now owns that run.
    // Coming back at the busy interval would send this runner straight at a
    // pool the other runner is working through, competing for claims it has
    // already lost once.
    //
    // Written because a deliberate regression (P16 R5) collapsed
    // `kind === "worked"` into `kind !== "idle"` and every test still passed —
    // the loop's own comment argued this property and nothing checked it.
    // ═══════════════════════════════════════════════════════════════════
    vi.useFakeTimers();
    const intake = intakeOf({ offers: [WORK], accept: false });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
      idleIntervalMs: 10_000,
      busyIntervalMs: 100,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(intake.claims).toBe(1);
      expect(intake.reports, "it did report; the plane would not have it").toHaveLength(1);

      // The busy interval passes, and nothing happens — because that turn was
      // not work, whatever it looked like from in here.
      await vi.advanceTimersByTimeAsync(100);
      expect(intake.claims, "a refused report is not a reason to hurry").toBe(1);
      await vi.advanceTimersByTimeAsync(9_900);
      expect(intake.claims, "it comes back at the idle interval").toBe(2);
    } finally {
      await supervisor.stop();
    }
  });

  it("never runs two turns at once, however slow one is", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Serial by construction. `runOneTurn` claims ONE unit deliberately —
    // a batch would hold leases on work it had not started — and overlapping
    // turns reintroduce that from the other end: several browsers, several
    // leases, one process to lose. It is also one request at a time to one
    // institution's portal, which is the polite reading.
    // ═══════════════════════════════════════════════════════════════════
    vi.useFakeTimers();
    const intake = intakeOf({ offers: [WORK, WORK, WORK] });
    let running = 0;
    let overlapped = false;
    // Declared with a no-op rather than `null`: a `resolve` captured inside a
    // Promise executor is invisible to the type checker's narrowing, so a
    // nullable one is permanently `null` to it and cannot be called.
    let release: () => void = () => undefined;

    const supervisor = startRunnerSupervisor({
      intake,
      perform: async (): Promise<PerformOutcome> => {
        running += 1;
        if (running > 1) overlapped = true;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        running -= 1;
        return { kind: "succeeded" };
      },
      idleIntervalMs: 1,
      busyIntervalMs: 1,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      // The first turn is stuck inside `perform`. Time passes; the timer that
      // would schedule the next turn cannot even be set until this one ends.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(intake.claims, "still only one claim").toBe(1);
      expect(overlapped).toBe(false);

      release();
      await vi.advanceTimersByTimeAsync(10);
      expect(intake.claims, "and now the next one").toBeGreaterThan(1);
      expect(overlapped, "never two at once").toBe(false);
    } finally {
      release();
      await supervisor.stop();
    }
  });

  it("survives an intake that throws, rather than dying quietly", async () => {
    // `runOneTurn` does not throw, so reaching the loop's catch means the
    // intake itself did something unexpected. A runner that stopped polling
    // because of one bad response is a runner that never comes back — and
    // nothing anywhere would notice.
    vi.useFakeTimers();
    const intake = intakeOf({ claimThrows: true });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
      idleIntervalMs: 500,
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(intake.claims).toBe(1);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(intake.claims, "still polling after a thrown claim").toBeGreaterThan(2);
    } finally {
      await supervisor.stop();
    }
  });
});

describe("stopping", () => {
  it("WAITS for a browser that is mid-action", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The difference between this and the Background Worker, whose `stop` is
    // synchronous. A worker's job is a database query and abandoning one costs
    // a repeat. A runner's turn is a real browser typing into a real university
    // portal, and abandoning one mid-action is the exact situation
    // `workflow_action_intents` exists to DETECT and `assessIntent` refuses to
    // retry — it would leave a run stopped, an intervention raised, and a
    // person having to go and look at a portal.
    // ═══════════════════════════════════════════════════════════════════
    const intake = intakeOf({ offers: [WORK] });
    let finished = false;
    // The gate is built BEFORE the performer rather than inside it: a `resolve`
    // captured from inside the callback is, to the type checker, still the
    // `null` it was declared as, and the test would not compile.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const supervisor = startRunnerSupervisor({
      intake,
      perform: async (): Promise<PerformOutcome> => {
        await held;
        finished = true;
        return { kind: "succeeded" };
      },
    });

    // Start a turn and let it reach the middle of `perform`.
    const turn = supervisor.runOnce();
    await Promise.resolve();

    const stopping = supervisor.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped, "stop is still waiting").toBe(false);

    release();
    await turn;
    await stopping;
    expect(finished, "the turn completed").toBe(true);
    expect(intake.reports, "and reported, so nothing is left uncertain").toHaveLength(1);
  });

  it("schedules nothing further once stopped", async () => {
    vi.useFakeTimers();
    const intake = intakeOf();
    const supervisor = startRunnerSupervisor({ intake, perform: () => Promise.resolve({ kind: "succeeded" }), idleIntervalMs: 100 });
    await vi.advanceTimersByTimeAsync(0);
    const claimsAtStop = intake.claims;

    await supervisor.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(intake.claims, "no polling after stop").toBe(claimsAtStop);
  });

  it("schedules nothing further when the turn it waited for FINISHES", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // The harder half of "schedules nothing further", and the one a rolling
    // deploy actually meets: `stop` is called while a browser is mid-action,
    // and the turn's own completion is what asks for the next one. Clearing
    // the pending timer cannot help — there is no pending timer while a turn
    // is in flight — so the only thing standing between a stopped runner and
    // an endless loop is the flag `scheduleNext` reads.
    //
    // Written because a deliberate regression (P16 R6) deleted that flag check
    // and all thirteen tests passed: `stop`'s `clearTimeout` covered the idle
    // case, and no test stopped a runner that was busy AND then let it finish.
    // ═══════════════════════════════════════════════════════════════════
    vi.useFakeTimers();
    const intake = intakeOf({ offers: [WORK] });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: async (): Promise<PerformOutcome> => {
        await held;
        return { kind: "succeeded" };
      },
      idleIntervalMs: 100,
      busyIntervalMs: 10,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(intake.claims, "one turn, stuck inside the browser").toBe(1);

    const stopping = supervisor.stop();
    release();
    await stopping;

    // Its turn WORKED, so an unstopped loop would come back in 10ms and go on
    // for ever. Five seconds of clock says it does not.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(intake.claims, "a stopped runner claims nothing more").toBe(1);
  });

  it("is idempotent", async () => {
    const supervisor = startRunnerSupervisor({
      intake: intakeOf(),
      perform: (): Promise<PerformOutcome> => Promise.resolve({ kind: "succeeded" }),
    });
    await supervisor.stop();
    await expect(supervisor.stop()).resolves.toBeUndefined();
  });
});

describe("what the supervisor does NOT decide", () => {
  it("performs whatever it is handed, and nothing it is not", async () => {
    // ═══════════════════════════════════════════════════════════════════
    // Every stop condition lives on the OTHER side of the intake: a cancelled
    // case (ADR-0053), an `uncertain` or `escalated` run (ADR-0048), a run
    // another runner holds (ADR-0045), an action that may already have
    // happened (ADR-0008). This loop inherits all of them by performing only
    // what it is offered.
    //
    // Asserted as the ABSENCE of a second opinion: when the plane offers
    // nothing, the performer is never reached — the supervisor does not go
    // looking, and has nowhere to look even if it wanted to, because the runner
    // has no database (ADR-0037).
    // ═══════════════════════════════════════════════════════════════════
    vi.useFakeTimers();
    let performed = 0;
    const intake = intakeOf({ offers: [null, null, WORK, null] });
    const supervisor = startRunnerSupervisor({
      intake,
      perform: (): Promise<PerformOutcome> => {
        performed += 1;
        return Promise.resolve({ kind: "succeeded" });
      },
      idleIntervalMs: 10,
      busyIntervalMs: 10,
    });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(intake.claims, "it kept asking").toBeGreaterThan(3);
      expect(performed, "and did exactly the one thing it was given").toBe(1);
    } finally {
      await supervisor.stop();
    }
  });
});
