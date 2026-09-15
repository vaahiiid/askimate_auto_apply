import { describe, expect, it } from "vitest";

import { proposeValue, studentId, unwrapConfirmed, provenanceOf } from "@askimate/aas-domain";
import type { ConfirmedValue } from "@askimate/aas-domain";

import { applyConfirmation, isDeclined } from "./confirmation.js";
import type { ProfileFieldKey, ProfileFieldType } from "./fields.js";
import { renderConfirmed, renderConfirmedItem } from "./format.js";

const NOW = new Date("2026-08-26T10:00:00Z");

/** Confirms a value the way the interview does, so tests start from real data. */
function confirmed<K extends ProfileFieldKey>(
  key: K,
  value: ProfileFieldType<K>,
): ConfirmedValue<ProfileFieldType<K>> {
  const result = applyConfirmation({
    key,
    proposed: proposeValue({
      value,
      origin: "conversation",
      verbatim: "as stated",
      confidence: 0.9,
    }),
    confirmation: {
      studentRef: studentId("student-1"),
      presentedText: "…",
      respondedAt: NOW,
      response: { kind: "accepted" },
    },
  });
  if (isDeclined(result)) expect.unreachable("the student accepted");
  return result.value;
}

describe("a date asked as three selects (P89)", () => {
  // Sheffield asks the date of birth as day, month and year dropdowns whose
  // values are "2", "April" and "1999". None of the closed patterns produces
  // one part of a date, so a mapping could not say it. Three more members of
  // the closed set — still not a format string.
  it("renders the day unpadded, the month by name, and the year", () => {
    const dob = confirmed("identity.date_of_birth", new Date("1999-04-02T00:00:00Z"));
    const day = renderConfirmed(dob, { kind: "date", pattern: "D" });
    const month = renderConfirmed(dob, { kind: "date", pattern: "MMMM" });
    const year = renderConfirmed(dob, { kind: "date", pattern: "YYYY" });
    if (!day.rendered || !month.rendered || !year.rendered) expect.unreachable("a date renders");
    expect(unwrapConfirmed(day.value)).toBe("2");
    expect(unwrapConfirmed(month.value)).toBe("April");
    expect(unwrapConfirmed(year.value)).toBe("1999");
  });
});

describe("rendering a confirmed value for a portal", () => {
  it("writes a date the way the portal writes dates", () => {
    const dob = confirmed("identity.date_of_birth", new Date("1999-04-02T00:00:00Z"));

    const british = renderConfirmed(dob, { kind: "date", pattern: "DD/MM/YYYY" });
    const iso = renderConfirmed(dob, { kind: "date", pattern: "YYYY-MM-DD" });
    const american = renderConfirmed(dob, { kind: "date", pattern: "MM/DD/YYYY" });

    if (!british.rendered || !iso.rendered || !american.rendered) {
      expect.unreachable("all three patterns fit a Date");
    }
    expect(unwrapConfirmed(british.value)).toBe("02/04/1999");
    expect(unwrapConfirmed(iso.value)).toBe("1999-04-02");
    expect(unwrapConfirmed(american.value)).toBe("04/02/1999");
  });

  it("carries the student's provenance through unchanged", () => {
    const dob = confirmed("identity.date_of_birth", new Date("1999-04-02T00:00:00Z"));
    const rendered = renderConfirmed(dob, { kind: "date", pattern: "DD/MM/YYYY" });
    if (!rendered.rendered) expect.unreachable("a Date renders");

    // Same fact, different notation — so the audit answer must not change.
    expect(provenanceOf(rendered.value)).toEqual(provenanceOf(dob));
  });

  it("reads one part of a structured value", () => {
    const qualification = confirmed("education.highest_qualification", {
      level: "Bachelor of Science",
      subject: "Industrial Engineering",
      institution: "Amirkabir University of Technology",
      countryCode: "IR",
      start: { year: 2018, month: 9 }, end: { kind: "completed", date: { year: 2022, month: 6 } },
      grade: "17.42",
      gradeScale: "20-point scale",
    });

    const subject = renderConfirmed(qualification, { kind: "part", path: "subject" });
    const year = renderConfirmed(qualification, {
      kind: "part",
      path: "end",
      then: { kind: "part", path: "date", then: { kind: "part", path: "year", then: { kind: "number" } } },
    });

    if (!subject.rendered || !year.rendered) expect.unreachable("both parts exist");
    expect(unwrapConfirmed(subject.value)).toBe("Industrial Engineering");
    expect(unwrapConfirmed(year.value)).toBe("2022");
  });

  it("splits a UK postcode into the two boxes a portal asks for, at the postcode's own seam and never at 3+3 (P116)", () => {
    // Sheffield's contact page takes the UK postcode as two boxes of four
    // (Vahid's read-back, 2026-09-13: both came back, each three characters
    // for his). His instruction: *"a UK postcode's two halves are not both
    // three characters in general — mine happens to be. Whatever the mapping
    // does must not assume 3+3."* The inward code is always the last three
    // characters — a digit and two letters; the outward code is the rest,
    // two to four. Case is the student's: the portal stores what is typed.
    const cases: readonly [string, string, string][] = [
      ["S10 2TN", "S10", "2TN"],
      ["SW1A 1AA", "SW1A", "1AA"],
      ["sw1a1aa", "sw1a", "1aa"],
      ["M1 1AE", "M1", "1AE"],
      [" ec1a 1bb ", "ec1a", "1bb"],
    ];
    for (const [typed, outward, inward] of cases) {
      const address = confirmed("contact.address", { line1: "1 Example Road", city: "Sheffield", postalCode: typed, countryCode: "GB" });
      const first = renderConfirmed(address, { kind: "part", path: "postalCode", then: { kind: "uk_postcode", part: "outward" } });
      const second = renderConfirmed(address, { kind: "part", path: "postalCode", then: { kind: "uk_postcode", part: "inward" } });
      if (!first.rendered || !second.rendered) expect.unreachable(`${typed} is a UK postcode`);
      expect(unwrapConfirmed(first.value), typed).toBe(outward);
      expect(unwrapConfirmed(second.value), typed).toBe(inward);
    }
  });

  it("REFUSES to split what is not a UK postcode, rather than guessing a seam", () => {
    for (const typed of ["12345", "S10", "", "S10 2T", "69001", "SW1A 1AAA", "S10-2TN"]) {
      const address = confirmed("contact.address", { line1: "1 Example Road", city: "Lyon", postalCode: typed, countryCode: "FR" });
      const result = renderConfirmed(address, { kind: "part", path: "postalCode", then: { kind: "uk_postcode", part: "outward" } });
      expect(result.rendered, JSON.stringify(typed)).toBe(false);
      if (!result.rendered) expect(result.refusal.kind).toBe("rule_does_not_fit");
    }
  });

  it("refuses a part the value does not have, rather than writing nothing", () => {
    const name = confirmed("identity.given_name", "Niloofar");
    const result = renderConfirmed(name, { kind: "part", path: "subject" });
    expect(result.rendered).toBe(false);
  });

  it("refuses a rule that does not fit the value's type", () => {
    const name = confirmed("identity.given_name", "Niloofar");
    const result = renderConfirmed(name, { kind: "date", pattern: "DD/MM/YYYY" });
    if (result.rendered) expect.unreachable("a string is not a date");
    expect(result.refusal.kind).toBe("rule_does_not_fit");
  });
});

describe("dropdown options", () => {
  const nationality = confirmed("identity.nationality", "Iranian");

  it("uses the portal's own option value", () => {
    const result = renderConfirmed(nationality, {
      kind: "option",
      options: { Iranian: "IR" },
    });
    if (!result.rendered) expect.unreachable("the option is mapped");
    expect(unwrapConfirmed(result.value)).toBe("IR");
  });

  it("REFUSES an unmapped value rather than choosing the closest option", () => {
    // The dropdown offers "Iran (Islamic Republic of)". A human can see that is
    // the same country. Software choosing it is software deciding what a
    // student's nationality is.
    const result = renderConfirmed(nationality, {
      kind: "option",
      options: { "Iran (Islamic Republic of)": "IR", Iraqi: "IQ" },
    });

    if (result.rendered) expect.unreachable("nothing matched exactly");
    expect(result.refusal.kind).toBe("no_matching_option");
    if (result.refusal.kind !== "no_matching_option") expect.unreachable("checked above");
    expect(result.refusal.value).toBe("Iranian");
  });

  it("does not match on case or whitespace either", () => {
    const result = renderConfirmed(nationality, { kind: "option", options: { iranian: "IR" } });
    expect(result.rendered).toBe(false);
  });
});

describe("the shape of the rule", () => {
  it("is data, so there is no formatter function to smuggle a value through", () => {
    // A closure could ignore its argument and return anything at all:
    //
    //   renderConfirmed(dateOfBirth, () => whateverTheModelSaid)
    //
    // which would produce a ConfirmedValue<string> carrying a real student's
    // provenance and a value they never confirmed. There is no such parameter.
    //
    // @ts-expect-error a function is not a FormatRule
    renderConfirmed(confirmed("identity.given_name", "Niloofar"), () => "anything");
  });

  it("cannot be reached without a confirmed value to start from", () => {
    // @ts-expect-error a plain string is not a ConfirmedValue
    renderConfirmed("Niloofar", { kind: "text" });
  });
});

describe("rendering one item of a list-valued field (P96)", () => {
  const STUDENT_P96 = studentId("stu-p96");
  const NOW_P96 = new Date("2026-09-11T00:00:00Z");
  function confirmedList(): ConfirmedValue<ProfileFieldType<"education.prior_qualifications">> {
    const result = applyConfirmation({
      key: "education.prior_qualifications",
      proposed: proposeValue({
        value: [
          { level: "BSc", subject: "Maths", institution: "A", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17", gradeScale: "iran_20_point" },
          { level: "Diploma", subject: "Physics", institution: "B", countryCode: "IR", start: { year: 2013, month: 9 }, end: { kind: "completed", date: { year: 2017, month: 6 } }, grade: "19", gradeScale: "iran_20_point" },
        ],
        origin: "conversation",
        verbatim: "as stated",
        confidence: 0.9,
      }),
      confirmation: { studentRef: STUDENT_P96, presentedText: "…", respondedAt: NOW_P96, response: { kind: "accepted" } },
    });
    if (isDeclined(result)) expect.unreachable("accepted");
    return result.value;
  }

  it("renders the named item through the rule, carrying the list's provenance", () => {
    const list = confirmedList();
    const second = renderConfirmedItem(list, 1, { kind: "part", path: "subject" });
    if (!second.rendered) expect.unreachable(second.refusal.kind);
    expect(unwrapConfirmed(second.value)).toBe("Physics");
    expect(provenanceOf(second.value)).toEqual(provenanceOf(list));
    const year = renderConfirmedItem(list, 0, { kind: "part", path: "end", then: { kind: "part", path: "date", then: { kind: "part", path: "year", then: { kind: "number" } } } });
    if (!year.rendered) expect.unreachable(year.refusal.kind);
    expect(unwrapConfirmed(year.value)).toBe("2021");
  });

  it("refuses a value that is not a list, and an item the list does not have", () => {
    const list = confirmedList();
    const beyond = renderConfirmedItem(list, 2, { kind: "part", path: "subject" });
    expect(beyond.rendered).toBe(false);
    if (!beyond.rendered) expect(beyond.refusal.kind).toBe("no_such_item");
    const name = applyConfirmation({
      key: "identity.given_name",
      proposed: proposeValue({ value: "Niloofar", origin: "conversation", verbatim: "Niloofar", confidence: 0.9 }),
      confirmation: { studentRef: STUDENT_P96, presentedText: "…", respondedAt: NOW_P96, response: { kind: "accepted" } },
    });
    if (isDeclined(name)) expect.unreachable("accepted");
    const notList = renderConfirmedItem(name.value, 0, { kind: "text" });
    expect(notList.rendered).toBe(false);
    if (!notList.rendered) expect(notList.refusal.kind).toBe("not_a_list");
  });
});

describe("an employment entry, rendered for a portal (ADR-0111)", () => {
  const job = confirmed("employment.history", [
    {
      employer: "Example Employer Ltd",
      employerAddress: "1 Example Street, Sheffield, S1 1AA",
      position: "Research Assistant",
      startDate: { year: 2022, month: 9 },
      end: { kind: "ended", date: { year: 2024, month: 6 } },
      duties: "Ran the lab's weekly analysis.",
    },
    {
      employer: "Second Employer",
      employerAddress: "2 Other Road, Leeds",
      position: "Analyst",
      startDate: { year: 2024, month: 7 },
      end: { kind: "current" },
      duties: "Ongoing.",
    },
  ]);
  const MONTHS = { "1": "January", "2": "February", "3": "March", "4": "April", "5": "May", "6": "June", "7": "July", "8": "August", "9": "September", "10": "October", "11": "November", "12": "December" };

  it("renders a start month by the portal's own names through part-then-option, and the year as digits", () => {
    const month = renderConfirmedItem(job, 0, { kind: "part", path: "startDate", then: { kind: "part", path: "month", then: { kind: "option", options: MONTHS } } });
    const year = renderConfirmedItem(job, 0, { kind: "part", path: "startDate", then: { kind: "part", path: "year", then: { kind: "number" } } });
    if (!month.rendered || !year.rendered) expect.unreachable("both parts exist");
    expect(unwrapConfirmed(month.value)).toBe("September");
    expect(unwrapConfirmed(year.value)).toBe("2022");
  });

  it("JOINS the employer's name and address for a portal that asks for both in one box, in order, with the separator given", () => {
    const both = renderConfirmedItem(job, 0, { kind: "join", parts: ["employer", "employerAddress"], separator: "\n" });
    if (!both.rendered) expect.unreachable("both parts exist");
    expect(unwrapConfirmed(both.value)).toBe("Example Employer Ltd\n1 Example Street, Sheffield, S1 1AA");
  });

  it("refuses a join with a part the value does not have, rather than writing the rest", () => {
    const result = renderConfirmedItem(job, 0, { kind: "join", parts: ["employer", "referee"], separator: ", " });
    expect(result.rendered).toBe(false);
    if (!result.rendered) expect(result.refusal.kind).toBe("no_such_part");
  });

  it("leaves an end date EMPTY for a job the student said is current — the absence is theirs, and never a blank we inferred", () => {
    // `end` is always present: either an ended date or the student's statement
    // that the job continues. A rule into the date, told to leave the field
    // empty when there is none, renders "" for the current job and the month
    // for the ended one. Without that instruction the current job refuses.
    const rule = { kind: "part", path: "end", then: { kind: "part", path: "date", absent: "leave_empty", then: { kind: "part", path: "month", then: { kind: "option", options: MONTHS } } } } as const;
    const ended = renderConfirmedItem(job, 0, rule);
    const current = renderConfirmedItem(job, 1, rule);
    if (!ended.rendered || !current.rendered) expect.unreachable("both render");
    expect(unwrapConfirmed(ended.value)).toBe("June");
    expect(unwrapConfirmed(current.value)).toBe("");
    const strict = renderConfirmedItem(job, 1, { kind: "part", path: "end", then: { kind: "part", path: "date", then: { kind: "part", path: "month" } } });
    expect(strict.rendered).toBe(false);
    if (!strict.rendered) expect(strict.refusal.kind).toBe("no_such_part");
  });
});

describe("a stated absence types the portal's own words (ADR-0117)", () => {
  const text = (result: ReturnType<typeof renderConfirmed>): string =>
    result.rendered ? unwrapConfirmed(result.value) : `refused:${result.refusal.kind}`;

  it("renders the number for a held passport and the quoted instruction for none — never a blank, never a stored string", () => {
    const rule = { kind: "part", path: "number", absent: { typed: "no passport" } } as const;
    const held = confirmed("identity.passport", { kind: "held", number: "K12345678", expiry: new Date("2031-06-13T00:00:00Z") });
    const none = confirmed("identity.passport", { kind: "none" });
    expect(text(renderConfirmed(held, rule))).toBe("K12345678");
    expect(text(renderConfirmed(none, rule))).toBe("no passport");
    // The words come from the rule, so another portal's instruction is that
    // portal's mapping, not a second copy of Sheffield's.
    expect(text(renderConfirmed(none, { ...rule, absent: { typed: "N/A" } }))).toBe("N/A");
    // Without the clause, an absent part still refuses, as it always has.
    expect(text(renderConfirmed(none, { kind: "part", path: "number" }))).toBe("refused:no_such_part");
  });
});
