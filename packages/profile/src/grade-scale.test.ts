/**
 * The scale a grade is on, read as the student states it (P297).
 *
 * Vahid, 2026-10-12: *"Our own intake must record a grade and its scale
 * exactly as the student states them ("8.2 out of 10"). "GPA" must never be
 * silently read as out of 4."*
 */

import { describe, expect, it } from "vitest";

import { readGradeScale } from "./grade-scale.js";

describe("a grade scale is read as stated, never given a maximum nobody said (P297)", () => {
  it("never reads GPA, or anything else with no maximum, as out of 4 — or as anything", () => {
    for (const said of ["GPA", "gpa", " Gpa ", "CGPA", "GPA 4", "4.0", "First", "First Class", "UK", ""]) {
      expect(readGradeScale(said), said).toBeNull();
    }
  });

  it("keeps words that state a maximum exactly as said, trimmed of the space around them and nothing else", () => {
    for (const said of [
      "out of 10", "CGPA out of 10", "8.2 out of 10", "10-point", "10 point", "10 points", "ten-point", "/10", "CGPA/10", "out of 4.0", "GPA out of 5",
      "GPA out of 4.5", "out of ten", "on a scale of 10", "10 scale", "0 to 10", "0-10", "max 10", "maximum of 4", "percent", "70%",
    ]) {
      expect(readGradeScale(`  ${said} `), said).toBe(said);
    }
  });

  it("keeps the token only for a phrase that names its maximum, which the signed rows key on", () => {
    expect(readGradeScale("20-point")).toBe("twenty_point");
    expect(readGradeScale("Out of 20")).toBe("twenty_point");
    expect(readGradeScale("GPA out of 4")).toBe("gpa_4");
    expect(readGradeScale("UK honours")).toBe("uk_honours");
    expect(readGradeScale("percentage")).toBe("percentage");
    // A leading "on a" and a trailing "scale" name no other maximum.
    expect(readGradeScale("20-point scale")).toBe("twenty_point");
    expect(readGradeScale("on a 20 point scale")).toBe("twenty_point");
    expect(readGradeScale("20 point grading scale")).toBe("twenty_point");
    expect(Object.values(readGradeScale.options)).not.toContain(undefined);
    expect(Object.keys(readGradeScale.options)).not.toContain("gpa");
    expect(Object.keys(readGradeScale.options)).not.toContain("gpa 4");
  });

  it("marks itself for the model paths: a model's words are held to the student's", () => {
    expect(readGradeScale.asStated).toBe(true);
  });
});
