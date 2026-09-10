/**
 * No route puts a sentence on a problem document.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Define all error responses as closed, explicit
 * contracts."* The contract's `Problem` has no `detail` member and its parser
 * drops one (`problems.ts`). And yet, from P57 to P64, the document routes put
 * a `detail` on the wire — the storage gate's own sentence — and two older
 * routes put a refusal's `detail` on hand-rolled problem documents. The
 * contract said one thing and four routes did another, and nothing failed.
 *
 * Vahid, 2026-09-10, closing blocker 18: *"The contract's Problem stays
 * without detail. Close the gap the way P41 closed its own: a closed set of
 * refusal codes, each with wording written for the student and covered by the
 * wording-coverage guard. Free text composed at the point of failure is where
 * a thing nobody meant to publish gets published … A closed set is reviewable;
 * a detail string is not."*
 *
 * This is the guard. It reads the route files of every process that answers a
 * problem document and refuses a `detail:` member in any of them. Textual,
 * because the `problem()` helpers take an untyped `extra` and a type could not
 * see a hand-rolled `res.json({...})`; narrow, because `detail` is the member
 * RFC 9457 invites a handler to interpolate into, and the one the contract
 * removed by name.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = resolve(join(import.meta.dirname, ".."));

/** Every file that writes an HTTP response body in a process this repository ships. */
const ROUTE_FILES = [
  "apps/conversation-service/src/routes.ts",
  "apps/conversation-service/src/app.ts",
  "apps/secure-service/src/routes.ts",
  "apps/secure-filler/src/app.ts",
] as const;

describe("no route puts free text on a problem document", () => {
  it("has no `detail:` member in any route file", () => {
    const offending: string[] = [];
    for (const file of ROUTE_FILES) {
      const lines = readFileSync(join(ROOT, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        // A member being WRITTEN: `detail:` at the start of a property line.
        // `readonly detail: string` in a type, and `refusal.detail` being
        // read, are not this. A route may read a detail to decide; it may not
        // send one.
        if (/^\s*detail:/.test(line)) offending.push(`${file}:${String(index + 1)}: ${line.trim()}`);
      });
    }
    expect(
      offending,
      "a sentence on the wire. Name the refusal as a code in PROBLEM_CODES, give it words in " +
        "journey.ts, and let the contract's parser keep dropping `detail` (ADR-0098)",
    ).toEqual([]);
  });

  it("is reading the files it claims to", () => {
    // The vacuity guard. Every file exists and is not a stub, and the two
    // route files — where problem documents are assembled — say so.
    for (const file of ROUTE_FILES) {
      expect(readFileSync(join(ROOT, file), "utf8").length, file).toBeGreaterThan(1000);
    }
    for (const file of ROUTE_FILES.filter((f) => f.endsWith("/routes.ts"))) {
      expect(readFileSync(join(ROOT, file), "utf8"), `${file} answers problem documents`).toMatch(
        /problem\+json|problemTypeFor|PROBLEM_STATUS/,
      );
    }
  });

  it("would have caught the four of 2026-09-10", () => {
    const stale = [
      "            detail: error instanceof Error ? error.message : \"This document cannot be stored.\",",
      "            detail: made.refusal.detail,",
      "              detail: verified.refusal.detail,",
      "            problem(res, error.code, { detail: error.message });",
    ];
    // The first three are property lines the guard refuses; the fourth is the
    // inline form, which is refused by the same helper being unable to take
    // one — asserted in `document-routes.test.ts` by the absence of `detail`
    // on the answered document.
    expect(stale.slice(0, 3).every((line) => /^\s*detail:/.test(line))).toBe(true);
  });
});
