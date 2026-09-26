import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { RUN_PHASES, RUN_STATUSES, RUN_STEP_KINDS } from "@askimate/aas-contracts";

import { EVERY_SENTENCE, positionLine } from "./words.js";

describe("no internal word ever reaches a student's screen (P227, ADR-0147)", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // Vahid saw "Your application: specialist (running)" while the interview
  // was asking him questions. Decided, in his words: *"no internal word ever
  // reaches a student's screen. Not specialist, not escalated, not
  // uncertain. If the run is with a person, it says so in words a person
  // would use."*
  // ═══════════════════════════════════════════════════════════════════════
  const internal = [...RUN_STATUSES, ...RUN_STEP_KINDS, ...RUN_PHASES];
  const forms = internal.flatMap((word) => [word, word.replace(/_/g, " ")]);

  it("has a sentence for every status and every step, and none of them contains a state name", () => {
    for (const status of RUN_STATUSES) {
      for (const step of RUN_STEP_KINDS) {
        const line: string = positionLine({ status, step });
        expect(line.length, `${status}/${step}`).toBeGreaterThan(20);
        expect(line.endsWith("."), `${status}/${step} is a sentence`).toBe(true);
        for (const form of forms) {
          const pattern = new RegExp(`\\b${form.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
          expect(line, `${status}/${step} must not say "${form}"`).not.toMatch(pattern);
        }
      }
    }
    // The same over the table itself, so an unreachable sentence is held to it too.
    for (const sentence of EVERY_SENTENCE) {
      for (const form of forms) {
        expect(sentence).not.toMatch(new RegExp(`\\b${form}\\b`, "i"));
      }
    }
  });

  it("says a person has it when a person has it — the step he saw, and the two statuses", () => {
    const team = "Your application is with a member of the team. I will come back to you.";
    expect(positionLine({ status: "running", step: "specialist" })).toBe(team);
    expect(positionLine({ status: "escalated", step: "interview" })).toBe(team);
    expect(positionLine({ status: "uncertain", step: "execute" })).toBe(team);
  });

  it("describes a running run by its step, in the present tense", () => {
    expect(positionLine({ status: "running", step: "interview" })).toBe(
      "I'm asking you a few questions so I can fill in your application.",
    );
    expect(positionLine({ status: "running", step: "ready_to_submit" })).toBe(
      "Your application is entered and ready for you to submit.",
    );
    expect(positionLine({ status: "stopped_by_student", step: "request_secret" })).toContain("You closed the password box");
  });

  it("is the only way the page writes its position line — the run's fields are never interpolated", () => {
    // A source assertion, and said to be weaker than the type: what it proves
    // is that the template literal Vahid's line came from is gone and has
    // not come back beside the typed one.
    const raw = readFileSync(join(import.meta.dirname, "journey.ts"), "utf8");
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(source).not.toMatch(/\$\{run\.(step|status|phase)/);
    expect(source).not.toMatch(/run\.(step|status|phase)\.replace/);
    expect(source).toContain("positionLine(run)");
  });
});
