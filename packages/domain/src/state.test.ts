/**
 * Tests for the case state vocabulary.
 */

import { describe, expect, it } from "vitest";

import {
  BLOCKED_STATES,
  CASE_STATES,
  TERMINAL_STATES,
  hasAttemptedSubmission,
  isBlockedOnHuman,
  isTerminal,
} from "./state.js";

describe("the state vocabulary", () => {
  it("has no duplicates", () => {
    expect(new Set(CASE_STATES).size).toBe(CASE_STATES.length);
  });

  it("marks exactly the three approved terminal states", () => {
    expect([...TERMINAL_STATES].sort()).toEqual(["CANCELLED", "CONFIRMED", "FAILED_PERMANENT"]);
  });

  it("identifies terminal states", () => {
    expect(isTerminal("CONFIRMED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("FAILED_PERMANENT")).toBe(true);
    expect(isTerminal("PREPARING")).toBe(false);
  });

  it("treats CONFIRMED as terminal — MVP ends at submission confirmation", () => {
    // Brief §2.8. Anything after this (offer, rejection, deferral) is a later
    // phase and must not creep into the MVP state machine.
    expect(isTerminal("CONFIRMED")).toBe(true);
  });
});

describe("states blocked on a human", () => {
  it("counts waiting-on-a-person states", () => {
    // Used so a case waiting on a student is never counted as system
    // throughput — otherwise "slow" and "blocked" look identical in reporting.
    for (const state of BLOCKED_STATES) {
      expect(isBlockedOnHuman(state)).toBe(true);
    }
  });

  it("treats AWAITING_HANDOFF as blocked, not failed", () => {
    // Brief §6: a handoff is a normal, expected outcome.
    expect(isBlockedOnHuman("AWAITING_HANDOFF")).toBe(true);
    expect(isTerminal("AWAITING_HANDOFF")).toBe(false);
  });

  it("does not count active work as blocked", () => {
    expect(isBlockedOnHuman("PREPARING")).toBe(false);
    expect(isBlockedOnHuman("SUBMITTING")).toBe(false);
  });
});

describe("submission attempt detection", () => {
  it("is true from SUBMITTING onwards", () => {
    expect(hasAttemptedSubmission("SUBMITTING")).toBe(true);
    expect(hasAttemptedSubmission("SUBMITTED")).toBe(true);
    expect(hasAttemptedSubmission("CONFIRMED")).toBe(true);
  });

  it("is false before an attempt", () => {
    expect(hasAttemptedSubmission("AUTHORISED")).toBe(false);
    expect(hasAttemptedSubmission("PREPARING")).toBe(false);
  });
});
