/**
 * Every reason the server can state reaches the student in words.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P41's finding, and it is the P39 shape one layer further out.
 *
 * `PROBLEM_CODES` is closed, and the vocabulary argues for two of its members
 * on the explicit ground that a client must be able to tell them apart:
 * `already_applying` so a student whose earlier application has concluded can
 * be offered a second attempt, and `specialist_reviewing` so one whose run a
 * person is holding is not shown a dead end for something that resumes by
 * itself. Both were correct on the wire. Neither had a word on the page — they
 * fell through to "That did not work. Let me show you where things stand."
 *
 * Adding two strings fixes today. This test is what stops the NEXT code from
 * being added to the vocabulary and never reaching anybody: it fails on a code
 * that is in neither list, so the choice has to be made rather than defaulted.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * No database and no browser: the property is about two objects in one module
 * and the contract's own list. That the wording actually renders is proved in
 * `student-client.test.ts`, in a real browser, over a real refusal.
 */

import { describe, expect, it } from "vitest";

import { PROBLEM_CODES } from "@askimate/aas-contracts";

import { wording } from "./client/journey.js";

const { REFUSALS, CANNOT_REACH_THIS_PAGE } = wording;

describe("the words a refusal reaches the student in", () => {
  it("covers EVERY problem code the contract can produce", () => {
    const missing = PROBLEM_CODES.filter(
      (code) => REFUSALS[code] === undefined && CANNOT_REACH_THIS_PAGE[code] === undefined,
    );
    expect(
      missing,
      "these codes fall through to the generic notice — word them, or say here why this page cannot be told them",
    ).toEqual([]);
  });

  it("puts each code in ONE of the two lists, never both", () => {
    // Both would mean the page words a refusal it also claims it cannot get,
    // and there would be no way to tell which of the two statements is stale.
    const both = PROBLEM_CODES.filter(
      (code) => REFUSALS[code] !== undefined && CANNOT_REACH_THIS_PAGE[code] !== undefined,
    );
    expect(both).toEqual([]);
  });

  it("words NOTHING that is not a code this API can return", () => {
    // `contract_mismatch` is the exception and the only one: the transport
    // invents it for a body the contract's own parser refuses, which is a
    // failure no server states because a server that could state it would
    // have sent a body that parses.
    const codes = new Set<string>(PROBLEM_CODES);
    const invented = Object.keys(REFUSALS).filter(
      (code) => !codes.has(code) && code !== "contract_mismatch",
    );
    expect(invented, "a wording for a code nothing can send is dead text").toEqual([]);
  });

  it("says something DIFFERENT for each of the two the vocabulary argues for", () => {
    // The whole reason those codes exist rather than a shared 409. Identical
    // wording would satisfy the coverage test above and defeat its purpose.
    expect(REFUSALS["already_applying"]).not.toBe(REFUSALS["specialist_reviewing"]);
    expect(REFUSALS["already_applying"]).not.toBe(REFUSALS["not_found"]);
    expect(REFUSALS["specialist_reviewing"]).not.toBe(REFUSALS["not_found"]);
  });

  it("tells a student a person is looking, not that they did something wrong", () => {
    // P40 promised them, in the conversation: "you do not need to do anything
    // — I will tell you as soon as it moves again." A notice that contradicts
    // the transcript directly above it is worse than no notice.
    const held = REFUSALS["specialist_reviewing"] ?? "";
    expect(held).toMatch(/person/i);
    expect(held).toMatch(/do not need to do anything/i);
  });

  it("gives a REASON for every code it says cannot arrive here", () => {
    for (const [code, why] of Object.entries(CANNOT_REACH_THIS_PAGE)) {
      expect(why.length, code).toBeGreaterThan(20);
    }
  });
});
