import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FIXTURE_COUNTRIES } from "@askimate/aas-mapping/fixtures/countries";

import { onTheTestPortal, profileReplacing, studentsAsProfiles } from "./questions-by-nationality.js";
import { questionsToday, readEntry } from "./questions-per-application.js";

// P298, decision 5: the synthetic students of several nationalities, on the
// test portal and on Sheffield's signed entry. The numbers below are what the
// measure printed on 2026-10-12 against the entry as committed (mapping set
// 0.3.46); if the entry moves, these move with it, and the record's do too.

const ENTRY = readEntry(join(import.meta.dirname, "..", "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json"));
const students = studentsAsProfiles();

describe("questions per application by nationality (P298)", () => {
  it("holds the six students the plan names, each a nationality the test portal offers", () => {
    expect(students.map(({ student }) => student.code)).toEqual(["IN", "NG", "PK", "BD", "AE", "SA"]);
    const offered = new Set(FIXTURE_COUNTRIES.map((country) => country.value));
    for (const { student, profile } of students) {
      expect(profile.entries.get("identity.nationality")?.value.value, student.code).toBe(student.code);
      expect(offered.has(student.code), `${student.code} on the test portal's list`).toBe(true);
    }
  });

  it("the test portal takes every nationality, and its one question is the personal statement the synthetic profile never held", () => {
    for (const { student, profile } of students) {
      const portal = onTheTestPortal(profile);
      expect(portal.nationalityTaken, student.code).toBe(true);
      expect(portal.questions.map((q) => `${q.field}:${q.kind}`), student.code).toEqual(["personal_statement:ask"]);
      expect(portal.questions[0]?.reason).toBe("the profile holds no value for it (not_collected): the run asks the student");
    }
  });

  it("says NOT taken of a nationality the test portal does not offer — the check can say no", () => {
    const first = students[0];
    if (first === undefined) expect.unreachable("six students");
    const french = profileReplacing("FR", { ...first.student.replace, "identity.nationality": "FR" });
    const portal = onTheTestPortal(french);
    expect(portal.nationalityTaken).toBe(false);
    expect(portal.questions.map((q) => `${q.field}:${q.kind}`)).toContain("nationality:person");
  });

  it("on Sheffield's signed entry today: the questions per application each student meets", () => {
    const counted = Object.fromEntries(students.map(({ student, profile }) => [student.code, questionsToday(ENTRY, profile).map((q) => `${q.field}#${String(q.item ?? "-")}:${q.kind}`)]));
    const education = ["institution-ts-control#0:person", "gradingSystemId#0:person", "grade#0:person"];
    const subject = ["subjectSearch#0:person", "subject#0:person"];
    expect(counted).toEqual({
      IN: ["degree#0:choice", "institution-ts-control#0:person", ...subject, "gradingSystemId#0:person", "grade#0:person"],
      NG: ["institution-ts-control#0:person", ...subject, "gradingSystemId#0:person", "grade#0:person"],
      PK: ["degree#0:choice", ...education],
      BD: ["degree#0:choice", "institution-ts-control#0:person", ...subject, "gradingSystemId#0:person", "grade#0:person"],
      AE: ["degree#0:choice", ...education],
      SA: [...education],
    });
  });
});
