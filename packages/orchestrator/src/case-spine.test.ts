/**
 * The case spine, as a pure function (ADR-0049 §1).
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * P11's integration tests drive the spine through a real database, and they
 * are the ones that prove the run driver never writes a state itself. They are
 * NOT a good place to prove what `nextCaseHop` refuses, because a refusal
 * needs a case standing somewhere awkward — off the spine, or ahead of where
 * the run has read back to — and an integration test can only reach those by
 * arranging a whole run to get there.
 *
 * The P11 regression pass found that directly: breaking `nextCaseHop` so it
 * walked BACKWARDS changed nothing in the integration suite, because in the
 * fixtures the target never happens to read earlier than the case has got to.
 * The test named "does NOT walk backwards" was passing for the wrong reason —
 * `to === from`, so there was no hop either way. That is exactly the kind of
 * thing a deliberate regression exists to find, and the fix is a test that
 * asks the function the question directly.
 */

import { describe, expect, it } from "vitest";

import { ALLOWED_TRANSITIONS, WORKFLOW_PHASES } from "@askimate/aas-domain";
import type { CaseState } from "@askimate/aas-domain";

import { CASE_SPINE, caseStateFor, caseStateForStep, nextCaseHop } from "./durable.js";

describe("the case spine", () => {
  it("is a path the case machine itself allows, edge by edge", () => {
    // The strongest thing that can be said about the spine without repeating
    // it: every hop on it is a transition `checkTransition` would accept. A
    // spine containing an edge the machine forbids would deadlock every
    // healthy case at that hop, and would do so only in production.
    for (const [index, from] of CASE_SPINE.slice(0, -1).entries()) {
      const to = CASE_SPINE[index + 1];
      expect(to, "the spine has no gaps").toBeDefined();
      expect(
        ALLOWED_TRANSITIONS[from] as readonly CaseState[],
        `${from} → ${String(to)} must be a transition the machine allows`,
      ).toContain(to);
    }
  });

  it("names each state once", () => {
    // A repeated state would make `indexOf` answer about the first occurrence
    // and the walk would stall or loop.
    expect(new Set(CASE_SPINE).size).toBe(CASE_SPINE.length);
  });

  it("moves ONE state at a time, however far away the target is", () => {
    expect(nextCaseHop("INTAKE", "AUTHORISED")).toBe("REQUIREMENTS_RESOLUTION");
    expect(nextCaseHop("REQUIREMENTS_RESOLUTION", "AUTHORISED")).toBe("ELIGIBILITY_REVIEW");
    expect(nextCaseHop("PREPARING", "AUTHORISED")).toBe("AWAITING_STUDENT_AUTHORISATION");
  });

  it("NEVER walks backwards, for any pair on the spine", () => {
    // ═══════════════════════════════════════════════════════════════════
    // A case that has been authorised does not become un-prepared because a
    // later phase reads earlier. Moving it back would void an authorisation
    // the student gave, and voiding one is a separate, deliberate act.
    //
    // Every ordered pair, rather than one example: the failure this guards is
    // a run whose phase happens to read earlier at some moment nobody chose,
    // and picking one example would test the moment rather than the rule.
    // ═══════════════════════════════════════════════════════════════════
    for (const [from, current] of CASE_SPINE.entries()) {
      for (const target of CASE_SPINE.slice(0, from + 1)) {
        expect(
          nextCaseHop(current, target),
          `${current} must not move toward ${target}`,
        ).toBeNull();
      }
    }
  });

  it("does not walk a case that has LEFT the spine back onto it", () => {
    // Recovery, cancellation and the terminal states are not on the spine.
    // Whatever put a case there decides what happens next; this function does
    // not quietly resume a case somebody stopped.
    expect(nextCaseHop("AWAITING_HUMAN_REVIEW", "AUTHORISED")).toBeNull();
    expect(nextCaseHop("CANCELLED", "AUTHORISED")).toBeNull();
    expect(nextCaseHop("INTAKE", "SUBMITTING")).toBeNull();
  });

  it("places EVERY workflow phase on the spine", () => {
    // `caseStateFor` is a total switch, so this cannot fail to compile — but
    // it can answer with a state the walk cannot reach, and then a run in that
    // phase would silently never move its case.
    for (const phase of WORKFLOW_PHASES) {
      expect(CASE_SPINE, `${phase} must land somewhere the walk can reach`).toContain(
        caseStateFor(phase),
      );
    }
  });

  it("reads a step through the same phase mapping", () => {
    // `caseStateForStep` is the composition the Run Driver calls, and it exists
    // so that no coordinator derives a phase itself (`check-boundaries` bans
    // it). Composition, not a second table.
    expect(caseStateForStep({ kind: "ready_to_submit", contentHash: "sha256:whatever" })).toBe(
      caseStateFor("ready_to_submit"),
    );
  });
});
