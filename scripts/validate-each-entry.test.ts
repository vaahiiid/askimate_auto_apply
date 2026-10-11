/**
 * The validator checks each entry of a repeating page on its own (P296).
 *
 * Found reviewing his walk for P296: `validatePlan` keyed what the plan types
 * by the field alone, so on a repeating page the LAST entry's value stood for
 * every entry's. His two qualifications validated clean only in the order the
 * walk happened to use — the doctorate, its award title escaped (which submits
 * ""), then the Master's, whose "MSc" filled the award title for both. In the
 * other order the escape read as a missing title; with two titles escaped,
 * the first one's 36 characters went unchecked behind the second's; and one
 * qualification with its title escaped always stopped for a person.
 *
 * And the escape itself: Sheffield's award title submits "" for "Not in list"
 * (his read 6, P291). A chosen escape is the form's own answer, not a missing
 * one; the box it opens carries the words, under its own rules.
 *
 * Run on the signed Sheffield entry, with the walk the offer makes: each
 * offer answered with the form's escape, as on his run. What these assert is
 * the validator's; they hold with or without the grade row for his signature.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { entryChoiceOffer } from "@askimate/aas-conversation-service";
import { checkUsable, planFill } from "@askimate/aas-mapping";
import type { StudentChoice } from "@askimate/aas-mapping";
import { validatePlan } from "@askimate/aas-preparation";
import { rehydrateProfile } from "@askimate/aas-profile";
import type { StoredProfileEntry } from "@askimate/aas-profile";

import { readFixture } from "./profile-seed.js";
import { readEntry } from "./questions-per-application.js";

const ROOT = join(import.meta.dirname, "..");
const NOW = new Date("2026-10-11T12:00:00Z");
const BASE = { countryCode: "IR", subject: "International Business", start: { year: 2013, month: 9 }, end: { kind: "completed", date: { year: 2015, month: 9 } }, award: { year: 2015, month: 9 }, grade: "19.5", gradeScale: "twenty_point" };
const DOCTORATE = { ...BASE, level: "Doctorate", awardTitle: "Doctorate of Business Administration", institution: "HHE" };
const MASTERS = { ...BASE, level: "Master's degree", awardTitle: "MSc", institution: "Islamic Azad University" };

function violationsFor(qualifications: readonly object[]): string[] {
  return detailsFor(qualifications).map(({ ref }) => ref);
}

function detailsFor(qualifications: readonly object[]): { readonly ref: string; readonly detail: string }[] {
  const fixture = readFixture(readFileSync(join(ROOT, "docs", "run-a", "synthetic-profile.json"), "utf8"));
  if (!fixture.ok) expect.unreachable(JSON.stringify(fixture.refusal));
  const profile = rehydrateProfile({
    studentId: "each-entry",
    updatedAt: NOW,
    entries: fixture.fixture.entries.map((held) => ({ ...held, ...(held.key === "education.prior_qualifications" ? { value: qualifications } : {}), provenance: { source: "seeded", confirmedAt: NOW }, revision: 1 })) as unknown as readonly StoredProfileEntry[],
  });
  const entry = readEntry(join(ROOT, "docs", "run-a", "catalogue", "entries", "sheffield-pgt-2027-09.json"));
  const check = checkUsable(entry.mappingSet, entry.blueprint);
  if (!check.usable) expect.unreachable(check.refusal.detail);
  const choices: StudentChoice[] = [];
  const plan = () => planFill(entry.blueprint, check.mappingSet, profile, choices);
  const trial = (choice: StudentChoice) => planFill(entry.blueprint, check.mappingSet, profile, [...choices, choice]);
  for (let offer = entryChoiceOffer(entry.blueprint, plan(), trial); offer !== null; offer = entryChoiceOffer(entry.blueprint, plan(), trial)) {
    choices.push({ fieldRef: offer.fieldRef, ...(offer.item === undefined ? {} : { item: offer.item.index }), studentValue: offer.studentValue, value: offer.escape.value, label: offer.escape.label, escape: true, ...(offer.source.kind === "search" ? { searchedWith: offer.source.word } : {}) });
    expect(choices.length, "no offer is made for ever").toBeLessThan(12);
  }
  return validatePlan(entry.blueprint, plan()).violations.map((violation) => ({ ref: `${violation.fieldRef}#${String(violation.item)} ${violation.rule.kind}`, detail: violation.detail }));
}

describe("the validator checks each entry of a repeating page on its own (P296)", () => {
  it("his two qualifications, in the walk's order: the doctorate's 36 characters, in its own entry", () => {
    expect(violationsFor([DOCTORATE, MASTERS])).toEqual(["unlistedDegree#0 maxlength"]);
  });

  it("the same two the other way round: the same refusal, in the other entry, and no title read as missing", () => {
    expect(violationsFor([MASTERS, DOCTORATE])).toEqual(["unlistedDegree#1 maxlength"]);
  });

  it("one qualification, its award title escaped: the escape is an answer, not a missing title", () => {
    expect(violationsFor([{ ...DOCTORATE, awardTitle: "DBA" }])).toEqual([]);
  });

  it("says it is what is planned for the box that is too long, not the box: the box's label is the page's sentence (row 141)", () => {
    // Once a box carries the page's own words as its label, "<label> is 36
    // characters" says the label is. It is the student's words.
    const [only] = detailsFor([DOCTORATE, MASTERS]);
    expect(only?.detail).toMatch(/^What is planned for "[^"]+" is 36 characters; the portal allows 28\./);
  });

  it("two titles escaped, both too long for the box: both refused, each in its own entry", () => {
    expect(violationsFor([DOCTORATE, { ...MASTERS, awardTitle: "Master of International Business Studies" }])).toEqual(["unlistedDegree#0 maxlength", "unlistedDegree#1 maxlength"]);
  });
});
