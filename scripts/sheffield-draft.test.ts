/**
 * The Sheffield artefacts, as committed, hold together under the real checks.
 *
 * `docs/captures/sheffield-pgt-2026-09-10/` carries the curated draft
 * blueprint and the equal-opportunities mapping set that ADR-0102 produced.
 * Both are DRAFTS — `checkUsable` rightly refuses a draft — so this test does
 * what a second reviewer's signature would do, in memory, and asserts what
 * must then be true: every field classified, the two refusals accepted, the
 * eleven covered controls neither answered nor blockers, the only blockers the
 * required fields on pages nobody has mapped yet, and the preview block
 * reading as Vahid specified — the quote on the disability refusal, nothing
 * quoted on ethnic origin, because that field's text says nothing.
 *
 * Vahid, 2026-09-11: *"Omit, do not borrow the disability field's sentence."*
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { chooseApproach } from "@askimate/aas-account";
import type { ObservedPortalAuthentication } from "@askimate/aas-account";
import { parseBlueprint, parseMappingSet } from "@askimate/aas-catalogue";
import { proposeValue, studentId } from "@askimate/aas-domain";
import { checkUsable, planFill, textOf, toStoredPlan } from "@askimate/aas-mapping";
import { buildPreview, renderPreview } from "@askimate/aas-preparation";
import type { ConfirmedProfile, ProfileFieldKey, ProfileFieldType } from "@askimate/aas-profile";
import { applyConfirmation, confirmField, emptyProfile, isDeclined } from "@askimate/aas-profile";

const NOW = new Date(0);
const STUDENT = studentId("stu");

function withConfirmed(entries: readonly [ProfileFieldKey, unknown][]): ConfirmedProfile {
  let profile = emptyProfile(STUDENT, NOW);
  for (const [key, value] of entries) {
    const result = applyConfirmation({
      key,
      proposed: proposeValue({
        value: value as ProfileFieldType<ProfileFieldKey>,
        origin: "conversation",
        verbatim: "as stated",
        confidence: 0.9,
      }),
      confirmation: { studentRef: STUDENT, presentedText: "…", respondedAt: NOW, response: { kind: "accepted" } },
    });
    if (isDeclined(result)) expect.unreachable("accepted");
    profile = confirmField(profile, result, NOW);
  }
  return profile;
}

const PROFILE_ENTRIES: readonly [ProfileFieldKey, unknown][] = [
  ["identity.given_name", "Niloofar"],
  ["identity.family_name", "Hosseini"],
  ["identity.date_of_birth", new Date("1999-04-02T00:00:00Z")],
  ["contact.email", "niloofar.hosseini@example.com"],
  ["contact.address", { line1: "12 Example Road", city: "Sheffield", postalCode: "S10 2TN", countryCode: "GB" }],
];
const PROFILE = withConfirmed(PROFILE_ENTRIES);

const DIR = join(import.meta.dirname, "..", "docs", "captures", "sheffield-pgt-2026-09-10");

function facts(): ObservedPortalAuthentication {
  const raw = JSON.parse(readFileSync(join(DIR, "portal-authentication.draft.json"), "utf8")) as Record<string, unknown>;
  return { ...raw, observedAt: new Date(raw["observedAt"] as string) } as unknown as ObservedPortalAuthentication;
}

function load() {
  const blueprint = parseBlueprint(JSON.parse(readFileSync(join(DIR, "blueprint.draft.curated.json"), "utf8")));
  const mappingSet = parseMappingSet(
    JSON.parse(readFileSync(join(DIR, "mapping-set.draft.json"), "utf8")),
  );
  if (!blueprint.ok) expect.unreachable(`blueprint: ${JSON.stringify(blueprint.refusal)}`);
  if (!mappingSet.ok) expect.unreachable(`mapping set: ${JSON.stringify(mappingSet.refusal)}`);
  return { blueprint: blueprint.value, mappingSet: mappingSet.value };
}

describe("the Sheffield drafts, under the real checks", () => {
  const { blueprint, mappingSet } = load();
  // What a second reviewer's signature would do. In memory only: the files
  // stay drafts, and the signature is Iman's to give, not this test's.
  const asIfReviewed = { ...mappingSet, status: "reviewed" as const, reviewedBy: "reviewer-b", reviewedAt: new Date(0) };

  it("are drafts, and the checks say so", () => {
    expect(blueprint.status).toBe("draft");
    expect(mappingSet.status).toBe("draft");
    const check = checkUsable(mappingSet, blueprint);
    expect(check.usable).toBe(false);
    if (!check.usable) expect(check.refusal.kind).toBe("not_reviewed");
  });

  it("carry the third read's row-text labels and observed markers on the five pages — 79 labels, 50 markers, the fourteen wrong labels excluded, the thirteen unread left as their names (P126)", () => {
    // Vahid, 2026-09-14: "the ceiling is 106 of 149 because 43 fields have no
    // question of their own, and the 13 between 93 and 106 are not a tool
    // failure. They are markup a positional rule cannot reach." And: "79
    // right is better than 93 with 14 wrong."
    const five = ["page5", "page6", "page7", "page10", "page11"];
    const fields = blueprint.pages.filter((p) => five.includes(p.pageRef)).flatMap((p) => p.sections.flatMap((s) => s.fields));
    expect(fields).toHaveLength(144);
    const rowText = fields.filter((f) => f.labelSource === "row_text");
    expect(rowText).toHaveLength(79);
    for (const f of rowText) expect(f.label, f.fieldRef).not.toBe(f.fieldRef);
    const marked = fields.filter((f) => f.validations.some((v) => v.kind === "required" && v.source === "observed_marker"));
    expect(marked).toHaveLength(50);
    // The fourteen the third rule got wrong are not carried: no label from
    // the row, and the field's name stands.
    const WRONG = [
      "institutionCode", "unlistedInstitution", "unlistedDegree", "grade", "unlistedGrade",
      "previousCountry1", "dateFromDay1", "dateFromMonth1", "dateFromYear1", "dateToDay1", "dateToMonth1", "dateToYear1",
      "otherInst1", "otherInstCourse1",
    ];
    for (const ref of WRONG) {
      const f = fields.find((x) => x.fieldRef === ref);
      expect(f?.labelSource, ref).toBeUndefined();
      expect(f?.label, ref).toBe(ref);
    }
    // The thirteen read from the screenshots at review: unlabelled here, by
    // name, and never a label the file did not carry.
    const THIRTEEN = [
      "fundingNationality", "secondFundingNationality", "countryOfBirth", "permanentResidence", "ukPermanentResidence",
      "dateEnteredUKDay", "dateEnteredUKMonth", "dateEnteredUKYear", "yearsOnStudentVisa", "monthsOnStudentVisa", "applicationLocation",
      "previousEnglishEducation", "languageCertificateStatus",
    ];
    for (const ref of THIRTEEN) {
      const f = fields.find((x) => x.fieldRef === ref);
      expect(f?.labelSource, ref).toBeUndefined();
    }
    // The two marks flagged for Iman are carried as observed, not dropped.
    expect(fields.find((f) => f.fieldRef === "unlistedDegree")?.validations.map((v) => v.kind)).toContain("required");
    expect(fields.find((f) => f.fieldRef === "languageCertificateStatus")?.validations.map((v) => v.kind)).toContain("required");
    expect(blueprint.version).toBe("0.2.28");
  });

  it("carry the education chain's dependent lists as OBSERVED with an institution and a grading system chosen (P132, distance item 5)", () => {
    // Vahid's read of education.do?new=true as it stood (--as-is, 645da1f):
    // United Kingdom, University of Sheffield, "UK Bachelors Degree (BA,
    // BSc)", and "business" searched. The chain institutionCountry →
    // institutionCode → gradingSystemId → grade is written from what the
    // page held, not inferred.
    const education = blueprint.pages.find((p) => p.pageRef === "page7");
    const field = (ref: string) => education?.sections.flatMap((s) => s.fields).find((f) => f.fieldRef === ref);
    const values = (ref: string) => field(ref)?.options?.map((o) => o.value) ?? [];
    expect(values("institutionCountry")).toContain("UNITED KINGDOM");
    // The hidden select behind the typeahead holds the chosen entry's value —
    // the same value the recorded typeahead entry carries (P118, ADR-0109).
    expect(values("institutionCode")).toEqual(["", "SHEFFIELD"]);
    // P153 (0.2.26): the two hidden selects are FRONTED by the boxes that set
    // them, so the plan lists them nowhere — not typed, not left empty.
    expect(field("institutionCountry")?.frontedBy).toBe("institutionCountry-ts-control");
    expect(field("institutionCode")?.frontedBy).toBe("institution-ts-control");
    expect(field("institution-ts-control")?.options?.find((o) => o.label === "University of Sheffield")?.value).toBe("SHEFFIELD");
    expect(field("institutionCode")?.optionsAfter?.fieldRef).toBe("institutionCountry");
    // Sheffield's four grading systems, by numeric id, and the escape. Since
    // P149 (0.2.24) the grading systems follow the institution BOX — the one
    // the runner fills, which sets the hidden select the lookup reads
    // (getGradingSystemsForCountry.do?institutionCode=…, the dependencies
    // read) — the same shape P102 gave the institution box after the country
    // box. The hidden select itself still follows the hidden country select.
    expect(field("gradingSystemId")?.optionsAfter?.fieldRef).toBe("institution-ts-control");
    expect(field("gradingSystemId")?.options?.map((o) => [o.value, o.label])).toEqual([
      ["", "Select a grading system..."],
      ["Not in list", "Not in list"],
      ["7", "UK Bachelors Degree (BA, BSc)"],
      ["8", "UK Masters Degree (MA, MSc)"],
      ["9", "UK Research Degree"],
      ["81", "UK Medical Degree (MBBS, MBChB)"],
    ]);
    // The grades of system 7: six grades and two non-grades, values as labels.
    expect(field("grade")?.optionsAfter?.fieldRef).toBe("gradingSystemId");
    expect(values("grade")).toEqual([
      "Select your grade...", "Still waiting for grade", "Failed to complete course", "1st", "2.1", "2.2", "3rd", "Pass", "Fail",
    ]);
    // One search's results: eighty-five entries after the two placeholders;
    // two values carry a trailing space the label hides — exact match means
    // the value, space included.
    expect(field("subject")?.optionsAfter?.press?.value).toBe("subjectSearchButton");
    expect(values("subject")).toHaveLength(87);
    expect(values("subject").slice(0, 2)).toEqual(["Select subject...", "Not in list"]);
    expect(values("subject")).toContain("GCE Applied Business Advanced ");
    expect(field("subject")?.options?.find((o) => o.value === "GCE Applied Business Advanced ")?.label).toBe("GCE Applied Business Advanced");
    // The four date selects are marked mandatory; since P134 (ADR-0112) the
    // registry's Qualification carries the dates and the set maps them.
    for (const ref of ["startDateMonth", "startDateYear", "endDateMonth", "endDateYear"]) {
      expect(field(ref)?.validations.some((v) => v.kind === "required" && v.source === "observed_marker"), ref).toBe(true);
      expect(mappingSet.mappings.some((m) => m.fieldRef === ref), ref).toBe(true);
    }
    // P148 (ADR-0119): degree is required to save (Sheffield refused it by name, 2026-09-16)
    // and mapped for the synthetic profile's two levels. P149: the chain is mapped for
    // the synthetic profile's one Sheffield qualification — the two boxes the runner
    // fills (never the hidden selects behind them), the search word and the subject,
    // the grading system and the grade. The unlisted boxes stay nobody's.
    expect(mappingSet.mappings.find((m) => m.fieldRef === "degree")?.source.kind).toBe("profile_field");
    for (const ref of ["institutionCountry-ts-control", "institution-ts-control", "subjectSearch", "subject", "gradingSystemId", "grade"]) {
      expect(mappingSet.mappings.find((m) => m.fieldRef === ref)?.source.kind, ref).toBe("profile_field");
    }
    expect(mappingSet.mappings.some((m) => ["institutionCountry", "institutionCode", "unlistedInstitution", "unlistedSubject", "unlistedDegree", "unlistedGrade", "unlistedGradeDescription", "highestEducationLevel"].includes(m.fieldRef))).toBe(false);
  });

  it("plan the synthetic profile's Sheffield qualification onto the six chain boxes, and refuse loudly what the maps do not name (P149)", () => {
    // One Bachelor's from the University of Sheffield: the shape the captured
    // dependent lists were read for (P132), and the only one the drafts can
    // fill from what was observed. Values as the form submits them, the
    // typeahead text as the reviewer recorded it (ADR-0109).
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.detail);
    const sheffield = (over: Partial<{ level: string; awardTitle: string; subject: string; institution: string; countryCode: string; grade: string }>) => withConfirmed([
      ...PROFILE_ENTRIES,
      ["education.prior_qualifications", [
        { level: "Bachelor's degree", awardTitle: "BSc", subject: "Business Management", institution: "University of Sheffield", countryCode: "GB",
          start: { year: 2019, month: 9 }, end: { kind: "completed", date: { year: 2022, month: 6 } }, award: { year: 2022, month: 7 },
          grade: "2:1", gradeScale: "uk_honours", ...over },
      ]],
    ]);
    const plan = planFill(blueprint, check.mappingSet, sheffield({}));
    const typed = (ref: string) => plan.instructions.find((i) => i.fieldRef === ref && i.item?.index === 0);
    const valueOf = (ref: string) => { const i = typed(ref); return i === undefined ? undefined : textOf(i.value); };
    expect(valueOf("institutionCountry-ts-control")).toBe("UNITED KINGDOM");
    expect(typed("institutionCountry-ts-control")?.typeahead?.text).toBe("United Kingdom");
    expect(valueOf("institution-ts-control")).toBe("SHEFFIELD");
    expect(typed("institution-ts-control")?.typeahead?.text).toBe("University of Sheffield");
    expect(typed("institution-ts-control")?.optionsAfter?.fieldRef).toBe("institutionCountry-ts-control");
    // The search word is the one the 87 captured results came from — never
    // the subject typed into the search box as if the portal matched whole
    // names, which nobody has observed.
    expect(valueOf("subjectSearch")).toBe("business");
    expect(valueOf("subject")).toBe("Business Management");
    expect(typed("subject")?.optionsAfter?.press?.value).toBe("subjectSearchButton");
    expect(valueOf("gradingSystemId")).toBe("7");
    expect(typed("gradingSystemId")?.optionsAfter?.fieldRef).toBe("institution-ts-control");
    expect(valueOf("grade")).toBe("2.1");
    // REFUSES by design since 2026-09-25 (blocker 71): the box wants an award
    // title and the registry holds a level, so nothing is typed here and the
    // page cannot be completed. It read "BSc" until then — which is the bug,
    // not the baseline.
    // The award title, as the student STATED it (ADR-0142, P213) — never read
    // off the level. Until 2026-09-25 this box was written from
    // `Bachelor's degree` (blocker 71); from P209 it refused; now it is the
    // student's recognition of the portal's own list.
    expect(valueOf("degree")).toBe("BSc");
    expect(plan.blockers.find((b) => b.fieldRef === "degree")).toBeUndefined();
    // The hidden selects are neither typed nor blocking: the boxes set them.
    for (const ref of ["institutionCountry", "institutionCode"]) {
      expect(plan.instructions.some((i) => i.fieldRef === ref), ref).toBe(false);
      expect(plan.blockers.some((b) => b.fieldRef === ref), ref).toBe(false);
    }
    const onPage7 = new Set(blueprint.pages.find((p) => p.pageRef === "page7")?.sections.flatMap((s) => s.fields.map((f) => f.fieldRef)) ?? []);
    // Nothing on this page blocks for this profile — `institution` and
    // `subject` included, because the synthetic student's values are the one
    // row each of those maps holds, and `degree` because the title is stated.
    expect(
      [...new Set(plan.blockers.filter((b) => onPage7.has(b.fieldRef)).map((b) => b.fieldRef))].sort(),
    ).toEqual([]);
    expect(plan.unmapped.map((u) => u.fieldRef)).not.toContain("institutionCountry");
    expect(plan.unmapped.map((u) => u.fieldRef)).not.toContain("institutionCode");
    // What the maps do not name is a loud blocker on that box, never an
    // approximation: another institution (the eleven entries are Sheffield's
    // search), a Master's (system 8's grades were never read), an Iranian
    // grade on a Sheffield entry, a subject the one search did not list.
    const refusedOn = (profile: ReturnType<typeof sheffield>) =>
      planFill(blueprint, check.mappingSet, profile).blockers.filter((b) => b.kind === "render_refused").map((b) => b.fieldRef).sort();
    // Each row names the box that its own change makes unmappable, and
    // nothing else. `degree` left these rows in P213: with the title stated,
    // it is a map like the others — and a title the portal's list does not
    // carry refuses like the others (below).
    expect(refusedOn(sheffield({ institution: "Sharif University of Technology", countryCode: "IR" }))).toEqual(["institution-ts-control"]);
    expect(refusedOn(sheffield({ level: "Master's degree" }))).toEqual(["gradingSystemId"]);
    expect(refusedOn(sheffield({ grade: "17.2" }))).toEqual(["grade"]);
    expect(refusedOn(sheffield({ subject: "Industrial Engineering" }))).toEqual(["subject", "subjectSearch"]);
    expect(refusedOn(sheffield({ awardTitle: "Bachelor of Science" })), "a title spelt as the portal does not list it is asked about, not matched").toEqual(["degree"]);
  });

  it("fill a qualification's dates once per item — the expected end of one still running, the award boxes empty when there is none (P134, ADR-0112)", () => {
    const withTwo = withConfirmed([
      ...PROFILE_ENTRIES,
      ["education.prior_qualifications", [
        { level: "Bachelor's degree", awardTitle: "BSc", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR",
          start: { year: 2018, month: 9 }, end: { kind: "completed", date: { year: 2022, month: 6 } }, award: { year: 2022, month: 11 },
          grade: "17.2", gradeScale: "iran_20_point" },
        { level: "Master's degree", awardTitle: "MSc", subject: "Management", institution: "Sharif University of Technology", countryCode: "IR",
          start: { year: 2024, month: 9 }, end: { kind: "expected", date: { year: 2026, month: 6 } },
          grade: "Still waiting for grade", gradeScale: "iran_20_point" },
      ]],
    ]);
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, withTwo);
    expect(plan.repeats.find((r) => r.pageRef === "page7")?.count).toBe(2);
    const typed = (index: number) =>
      Object.fromEntries(plan.instructions.filter((i) => i.item?.index === index && ["startDateMonth", "startDateYear", "endDateMonth", "endDateYear", "awardDateMonth", "awardDateYear"].includes(i.fieldRef)).map((i) => [i.fieldRef, textOf(i.value)]));
    // P185: "Sep" and "Jun" until attempt 8 met the portal's refusal — this select's
    // own names are Sept and June, as the 2026-09-10 capture recorded (ADR-0136).
    expect(typed(0)).toEqual({ startDateMonth: "Sept", startDateYear: "2018", endDateMonth: "June", endDateYear: "2022", awardDateMonth: "Nov", awardDateYear: "2022" });
    // The degree is typed per qualification from the title the student STATED
    // (ADR-0142, P213) — never from the level, which was blocker 71: a level
    // does not determine a title. The repeat machinery reaches both entries.
    const degrees = plan.instructions.filter((i) => i.fieldRef === "degree").map((i) => [i.item?.index, textOf(i.value)]);
    expect(degrees).toEqual([[0, "BSc"], [1, "MSc"]]);
    expect(plan.blockers.filter((b) => b.fieldRef === "degree")).toHaveLength(0);
    expect(plan.instructions.some((i) => i.fieldRef === "unlistedDegree")).toBe(false);
    expect(plan.hidden.filter((h) => h.fieldRef === "unlistedDegree").map((h) => h.item?.index)).toEqual([0, 1]);
    expect(plan.handoffs.some((h) => h.fieldRef === "degree")).toBe(false);
    // A qualification with NO title stated — a diploma — is a loud blocker on
    // this box, never an approximation: the part is absent and the rule has no
    // `absent` arm, so it refuses with `no_such_part` rather than choosing.
    const diploma = withConfirmed([
      ...PROFILE_ENTRIES,
      ["education.prior_qualifications", [
        { level: "Higher Diploma", subject: "Accounting", institution: "Sharif University of Technology", countryCode: "IR",
          start: { year: 2018, month: 9 }, end: { kind: "completed", date: { year: 2020, month: 6 } }, award: { year: 2020, month: 9 },
          grade: "17.2", gradeScale: "iran_20_point" },
      ]],
    ]);
    const refused = planFill(blueprint, check.mappingSet, diploma);
    expect(refused.blockers.some((b) => b.fieldRef === "degree" && b.kind === "render_refused")).toBe(true);
    expect(refused.instructions.some((i) => i.fieldRef === "degree")).toBe(false);
    // The one still running: its expected end is typed as the date it is,
    // and the award boxes are left empty because there is no award — the
    // student's statement, not our inference.
    expect(typed(1)).toEqual({ startDateMonth: "Sept", startDateYear: "2024", endDateMonth: "June", endDateYear: "2026", awardDateMonth: "", awardDateYear: "" });
    for (const ref of ["startDateMonth", "startDateYear", "endDateMonth", "endDateYear"]) {
      expect(plan.blockers.map((b) => b.fieldRef), ref).not.toContain(ref);
    }
  });

  it("classify every one of the 216 fields, and accept the two refusals the form offers", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    expect(check.usable, check.usable ? "" : JSON.stringify(check.refusal).slice(0, 300)).toBe(true);
    if (!check.usable) expect.unreachable("usable");
    const plan = planFill(blueprint, check.mappingSet, emptyProfile(studentId("stu"), new Date(0)));
    expect(plan.instructions.filter((i) => i.value.kind === "form_refusal").map((i) => i.fieldRef)).toEqual([
      "ratherNotSay",
      "ethnicOriginCode",
    ]);
    // With an empty profile the mapped fields want values (the interview's
    // job); the four employment fields are mapped since P129 (ADR-0111) and
    // their page repeats over employment.history, so an EMPTY profile — no
    // list at all — reports them as value_unavailable, not no_mapping; and
    // since P126 the forty-four fields the third read marked mandatory on
    // nationality, language and education have no mapping — items 3, 4 and 5
    // of the distance list, which item 1's answer made visible. The six education companions
    // the read also marked are not here: a handed slot's companion is the
    // student's own act (ADR-0107). NOTHING else blocks: no covered control,
    // no unclassified field, no refused render.
    // P145 (ADR-0119): the twenty are handed to the student for Run A, so no
    // required field is without a mapping or a hand; what remains is the
    // synthetic profile's values.
    expect(new Set(plan.blockers.map((b) => b.kind))).toEqual(new Set(["value_unavailable"]));
    // P139 (ADR-0115) mapped the twelve nationality radios and P141 the
    // passport; P142 put the page's own show/hide on the draft from
    // nationality.js, so with NOTHING confirmed the sections a controlling
    // answer opens are hidden — neither typed nor missing — and only the
    // language and education pages' unmapped fields remain.
    expect(plan.blockers.filter((b) => b.kind === "no_mapping")).toEqual([]);
    // P147 (ADR-0119): the language page's section is optional in Sheffield's own
    // words, so its seventeen marked boxes are not boxes the page will not save
    // without — un-handed at Vahid's word, left empty and said so, with the words.
    // With no qualification confirmed the education page is filled zero times, so
    // its two handed boxes (degree, unlistedDegree) have no entry to be said under.
    expect(plan.handoffs.filter((h) => h.inputType !== "file")).toEqual([]);
    const language = blueprint.pages.find((p) => p.pageRef === "page6");
    const languageRefs = language?.sections.flatMap((s) => s.fields.map((f) => f.fieldRef)) ?? [];
    const leftEmpty = plan.unmapped.filter((f) => f.pageRef === "page6");
    expect(leftEmpty.map((f) => f.fieldRef).sort()).toEqual([...languageRefs].sort());
    for (const field of leftEmpty) {
      expect(field.formSays).toBe("If you do not have an English language qualification then you do not need to complete this section.");
    }
    expect(plan.handoffs.some((h) => languageRefs.includes(h.fieldRef))).toBe(false);
    expect(toStoredPlan({ ...plan, blockers: [] }).ok).toBe(true);
  });

  it("fill the personal and contact pages from a confirmed profile, the date as three selects", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, PROFILE);
    const typed = new Map(plan.instructions.map((i) => [i.fieldRef, textOf(i.value)]));
    expect(typed.get("forename")).toBe("Niloofar");
    expect(typed.get("surname")).toBe("Hosseini");
    expect(typed.get("dobDay")).toBe("2");
    expect(typed.get("dobMonth")).toBe("April");
    expect(typed.get("dobYear")).toBe("1999");
    expect(typed.get("confirmEmail")).toBe("niloofar.hosseini@example.com");
    expect(typed.get("corrCountry")).toBe("UNITED KINGDOM");
    // P116: the UK postcode is two boxes, split at the postcode's own seam.
    expect(typed.get("corrPostcode")).toBe("S10");
    expect(typed.get("corrPostcode2")).toBe("2TN");
    // P90: the international postcode box is hidden for a UK address, so it
    // is neither filled nor missing — the form does not show it.
    expect(typed.has("corrIntlPostcode")).toBe(false);
    expect(plan.hidden.map((h) => h.fieldRef)).toContain("corrIntlPostcode");
    // Twenty observed-mandatory fields on the language and education pages
    // (P126) have no mapping; the eight employment fields (P129, P134) and
    // the four nationality questions the page shows to everyone (P139, P142)
    // are mapped and, with nothing confirmed for them, unavailable — required
    // or not: an unmapped optional box is left alone, a MAPPED one with no
    // value is a value the student has not given. Every other nationality
    // field sits behind an answer the page has not got, so it is hidden.
    expect(plan.blockers.filter((b) => b.kind === "no_mapping")).toHaveLength(0);
    // Every box handed rather than mapped (P145, ADR-0119) is one of the
    // fifteen on the language page or the two per qualification on education.
    // P148: the set hands nothing to the student on any page; every own act is a document slot.
    expect(plan.handoffs.filter((h) => h.inputType !== "file")).toEqual([]);
    expect(plan.blockers.filter((b) => b.kind === "value_unavailable").map((b) => b.fieldRef).sort()).toEqual([
      "countryOfBirth",
      "degree",
      "duties", "employerDetails", "endDateMonth", "endDateYear",
      "fundingNationality", "livedOutsideCountry", "permanentResidence",
      "position", "startDateMonth", "startDateYear", "startMonth",
    ]);
    // P149's six chain boxes are mapped per qualification but carry no
    // observed marker, so with no list at all they are neither typed nor
    // unavailable — only the marked degree and dates are.
  });

  it("fill the employment page once per job from the registry group, and leave the end date empty for a current job (P129, ADR-0111)", () => {
    expect(blueprint.version).toBe("0.2.28");
    expect(mappingSet.version).toBe("0.3.38");
    const employment = blueprint.pages.find((p) => p.pageRef === "page8");
    expect(employment?.repeats?.fieldKey).toBe("employment.history");
    expect(employment?.title).toBe("Employment history");
    // P130 (ADR-0106): the listing, from Vahid's read of summary.do with one
    // throwaway job saved — the heading reads exactly "Previous Employment 1",
    // the same shape as education's, and the locator is exact to the number.
    expect(employment?.repeats?.recorded).toEqual({
      url: "https://www.sheffield.ac.uk/postgradapplication/summary.do",
      entryLocator: { strategy: "css", value: 'div.homepageInfomation > h5:text-matches("^Previous Employment [0-9]+$")' },
    });
    const withJobs = withConfirmed([
      ...PROFILE_ENTRIES,
      ["employment.history", [
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
      ]],
    ]);
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, withJobs);
    expect(plan.repeats.find((r) => r.pageRef === "page8")?.count).toBe(2);
    const typed = (index: number) =>
      Object.fromEntries(plan.instructions.filter((i) => i.item?.index === index && ["startMonth", "startYear", "endMonth", "endYear", "position", "employerDetails", "duties"].includes(i.fieldRef)).map((i) => [i.fieldRef, textOf(i.value)]));
    expect(typed(0)).toEqual({
      startMonth: "September", startYear: "2022", endMonth: "June", endYear: "2024",
      position: "Research Assistant",
      employerDetails: "Example Employer Ltd\n1 Example Street, Sheffield, S1 1AA",
      duties: "Ran the lab's weekly analysis.",
    });
    // The current job: the end-date boxes are left empty because the student
    // said the job continues — their statement, not a blank we inferred.
    expect(typed(1)).toEqual({
      startMonth: "July", startYear: "2024", endMonth: "", endYear: "",
      position: "Analyst",
      employerDetails: "Second Employer\n2 Other Road, Leeds",
      duties: "Ongoing.",
    });
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("position");
  });

  it("fill the nationality page as its script shows it — the sections a UK resident sees hidden for a student resident abroad, the history's periods into the four blocks, no day anywhere, 'no passport' for a stated none, the study block after 'yes' (P139, P141, P142)", () => {
    const abroad: [ProfileFieldKey, unknown][] = [
      ...PROFILE_ENTRIES,
      ["identity.nationality", "IR"],
      ["identity.country_of_birth", "IR"],
      ["residence.country", "IR"],
      ["residence.in_uk_now", true],
      ["residence.uk_entry_date", { year: 2019, month: 9 }],
      ["residence.history", [
        { countryCode: "IR", from: { year: 2015, month: 9 }, to: { kind: "ended", date: { year: 2019, month: 8 } } },
        { countryCode: "GB", from: { year: 2019, month: 9 }, to: { kind: "current" } },
      ]],
      ["residence.always_in_residence_country", false],
      ["residence.always_in_eu", false],
      ["residence.outside_residence_country_last_three_years", true],
      ["immigration.uk_status", {
        british_passport: false, indefinite_leave: false, refugee_status: false, migrant_worker: false,
        spouse_of_uk_citizen: false, eu_passport: false, spouse_of_eu_citizen: false,
      }],
      ["immigration.uk_study", { kind: "none" }],
      ["identity.passport", { kind: "none" }],
    ];
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const page5 = blueprint.pages.find((p) => p.pageRef === "page5");
    const refs = new Set(page5?.sections.flatMap((s) => s.fields.map((f) => f.fieldRef)) ?? []);
    const plan = planFill(blueprint, check.mappingSet, withConfirmed(abroad));
    const typed = new Map(plan.instructions.map((i) => [i.fieldRef, textOf(i.value)]));
    const hidden = new Set(plan.hidden.map((h) => h.fieldRef));

    // The questions the page shows to everyone, from the registry: the
    // portal's own suffixed values, which its script reads (IR:O — overseas).
    expect(typed.get("fundingNationality")).toBe("IR:O");
    expect(typed.get("countryOfBirth")).toBe("IR:O");
    expect(typed.get("permanentResidence")).toBe("Iran, Islamic Republic of:O");
    expect(typed.get("livedOutsideCountry"), "outside of IRAN in the last three years — the span, not the UK").toBe("yes");
    // After "yes": the country blocks and the living-in-the-UK question.
    expect(typed.get("livingInUK")).toBe("yes");
    expect(typed.get("previousCountry1")).toBe("IRAN:O");
    expect(typed.get("dateFromMonth1")).toBe("Sept");
    expect(typed.get("dateFromYear1")).toBe("2015");
    expect(typed.get("dateToMonth1")).toBe("Aug");
    expect(typed.get("dateToYear1")).toBe("2019");
    expect(typed.get("previousCountry2")).toBe("UNITED KINGDOM:H");
    expect(typed.get("dateToMonth2"), "a current period's end is empty").toBe("");
    expect(typed.get("previousCountry3"), "empty beyond what the student listed").toBe("");
    for (const day of ["dateFromDay1", "dateToDay1", "dateFromDay2", "dateToDay2", "dateEnteredUKDay"]) expect(typed.has(day), day).toBe(false);
    // What a resident ABROAD is never shown, by the script: the always-lived
    // questions, the entry date, the seven UK and EU status claims (asked only
    // of a non-UK national resident in the UK or the EU), the UK region.
    for (const ref of ["alwaysUKResident", "alwaysEUResident", "dateEnteredUKMonth", "dateEnteredUKYear", "britishPassport", "indefinateVisa",
      "refugeeStatus", "migrantWorker", "spouseOfUKCitizen", "euPassport", "spouseOfEUCitizen", "ukPermanentResidence"]) {
      expect(hidden.has(ref), `${ref} hidden`).toBe(true);
      expect(typed.has(ref), `${ref} not typed`).toBe(false);
    }
    // A non-UK national is asked for the passport: none, stated — the
    // portal's own instruction typed, quoted into the mapping (ADR-0117).
    expect(typed.get("passportNumber")).toBe("no passport");
    // And about previous UK study: none, so the block after "yes" is hidden.
    expect(typed.get("previousStudentVisa")).toBe("no");
    for (const ref of ["qualificationLevel", "highestQualificationOther", "yearsOnStudentVisa", "visaExpiryMonth", "applicationLocation"]) {
      expect(hidden.has(ref), `${ref} hidden`).toBe(true);
    }
    expect(plan.blockers.filter((b) => refs.has(b.fieldRef)), "nothing on the page blocks").toEqual([]);

    // The same student with previous UK study: the block opens and is filled
    // from immigration.uk_study — the level in the portal's words, the time on
    // the visa, the expiry as day, month (the select's own spelling) and year.
    const studied = planFill(blueprint, check.mappingSet, withConfirmed(abroad.map(([k, v]) => k === "immigration.uk_study"
      ? [k, { kind: "studied", onStudentVisa: true, highestLevel: "university", qualification: "MSc Data Science", timeOnVisa: { years: 1, months: 3 }, currentVisaExpiry: new Date("2027-09-30T00:00:00Z") }]
      : [k, v])));
    const typed2 = new Map(studied.instructions.map((i) => [i.fieldRef, textOf(i.value)]));
    expect(typed2.get("previousStudentVisa")).toBe("yes");
    expect(typed2.get("qualificationLevel")).toBe("UNIVERSITY_LEVEL");
    expect(typed2.get("yearsOnStudentVisa")).toBe("1");
    expect(typed2.get("monthsOnStudentVisa")).toBe("3");
    expect(typed2.get("applicationLocation")).toBe("Inside UK");
    expect(typed2.get("visaExpiryDay")).toBe("30");
    expect(typed2.get("visaExpiryMonth")).toBe("Sept");
    expect(typed2.get("visaExpiryYear")).toBe("2027");
    expect(new Set(studied.hidden.map((h) => h.fieldRef)).has("highestQualificationOther"), "the Other text, hidden for a university level").toBe(true);
    // The one thing still open on the page: the qualification select for the
    // chosen level wants the portal's own list, blocker 25's shape.
    // P150: the university-level select is mapped for the synthetic profile's one
    // qualification only (set 0.3.31, the same shape as P149's institution map), so
    // a qualification the map does not name is a loud render_refused, never a gap
    // nobody looked at and never an approximation.
    expect(studied.blockers.filter((b) => refs.has(b.fieldRef)).map((b) => [b.kind, b.fieldRef])).toEqual([["render_refused", "highestQualification(UNIVERSITY_LEVEL)"]]);

    // A held passport types its number.
    const held = planFill(blueprint, check.mappingSet, withConfirmed([
      ...abroad.filter(([k]) => k !== "identity.passport"),
      ["identity.passport", { kind: "held", number: "K12345678", expiry: new Date("2031-06-13T00:00:00Z") }],
    ]));
    expect(held.instructions.filter((i) => i.fieldRef === "passportNumber").map((i) => textOf(i.value))).toEqual(["K12345678"]);
  });

  it("complete the employment page with NO entries when the student confirmed none, and say so plainly in the preview (P129, ADR-0111)", () => {
    // Vahid, 2026-09-14: "A student with nothing to add should see that we
    // knew and chose to leave it empty, not wonder whether we forgot."
    const none = withConfirmed([...PROFILE_ENTRIES, ["employment.history", []]]);
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, none);
    expect(plan.repeats.find((r) => r.pageRef === "page8")?.count).toBe(0);
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("position");
    expect(plan.instructions.map((i) => i.fieldRef)).not.toContain("position");
    // Confirmed-empty is not unavailable: the same page with NO list at all
    // blocks on its required fields, as any unasked value does.
    const unasked = planFill(blueprint, check.mappingSet, PROFILE);
    expect(unasked.blockers.filter((b) => b.kind === "value_unavailable").map((b) => b.fieldRef).sort()).toEqual([
      "countryOfBirth",
      "degree",
      "duties", "employerDetails", "endDateMonth", "endDateYear",
      "fundingNationality", "livedOutsideCountry", "permanentResidence",
      "position", "startDateMonth", "startDateYear", "startMonth",
    ]);
    // The preview says it, inside the yes.
    const page = { ...blueprint, pages: blueprint.pages.filter((p) => p.pageRef === "page8") };
    const onPage = new Set(page.pages.flatMap((p) => p.sections.flatMap((s) => s.fields.map((f) => f.fieldRef))));
    const pageOnly = { ...asIfReviewed, mappings: asIfReviewed.mappings.filter((m) => onPage.has(m.fieldRef)) };
    const pageCheck = checkUsable(pageOnly, page);
    if (!pageCheck.usable) expect.unreachable(pageCheck.refusal.kind);
    const pagePlan = planFill(page, pageCheck.mappingSet, none);
    const preview = buildPreview(page, pagePlan, new Map(), { portalHost: "www.sheffield.ac.uk" });
    if (!preview.built) expect.unreachable(preview.refusal.kind);
    expect(renderPreview(preview.preview)).toContain("Employment history:\n  none — the page is left as it is");
    expect(preview.preview.repeats).toEqual([{ title: "Employment history", fieldKey: "employment.history", count: 0 }]);
  });

  it("carry the registration and login the entry page showed, the passwords to the Secure Plane (P91)", () => {
    expect(blueprint.authentication.loginUrl).toBe("https://www.sheffield.ac.uk/postgradapplication/");
    expect(blueprint.authentication.login?.emailLocator).toEqual({ strategy: "id", value: "returnemail" });
    expect(blueprint.pages[0]?.pageRef).toBe("page0");
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, PROFILE);
    // A password field reaches the plan only as a credential requirement — no
    // value, no instruction — and the e-mail is typed from the profile.
    expect(plan.credentials.map((c) => c.fieldRef).sort()).toEqual(["newconfirmpassword", "newpassword"]);
    expect(plan.instructions.find((i) => i.fieldRef === "newemail")?.value.kind).toBe("confirmed");
  });

  it("record eight authentication facts, all observed, and the chooser picks student_chosen (P92)", () => {
    // AUTH 4 and 5 could not be settled by a page that was read. They are
    // settled by Vahid's direct statement of 2026-09-11 — observed by him,
    // not by a run — and the file says so in its comment, because the type
    // carries no per-fact provenance. For this entry only, in his words:
    // "this is Sheffield's behaviour, not a property of direct portals."
    const observed = facts();
    expect(observed.applicantChoosesPassword).toBe(true);
    expect(observed.emailVerificationRequired).toBe(false);
    expect(observed.mfaOrOtpRequired).toBe(false);
    const choice = chooseApproach({ observed, studentPresentAtCreation: true });
    expect(choice.chosen).toBe(true);
    if (choice.chosen) expect(choice.plan.approach).toBe("student_chosen");
  });

  it.each([["emailVerificationRequired"], ["mfaOrOtpRequired"]] as const)(
    "still REFUSES when %s alone is set back to unobserved — the refusal bites, it has not merely stopped firing",
    (fact) => {
      // "An unobserved answer is not a no." Proved on each of the two facts
      // his statement settled, one at a time, against the committed file.
      const observed = { ...facts(), [fact]: "unobserved" as const };
      const choice = chooseApproach({ observed, studentPresentAtCreation: true });
      expect(choice.chosen).toBe(false);
      if (choice.chosen) expect.unreachable("an unobserved fact must refuse");
      expect(choice.refusal.kind).toBe("unobserved");
      if (choice.refusal.kind === "unobserved") expect(choice.refusal.questions).toHaveLength(1);
    },
  );

  it("refuse to render a country the partial map does not name, rather than approximate", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    // `FR` until P206, which put 231 countries into this map — France among
    // them. `CY` is the country the map still does not name, and deliberately:
    // Vahid HELD it on every field under blocker 70, because Sheffield offers
    // several Cypruses carrying a fee-status marker and only a student can say
    // which. So this is now the stronger version of the same check — the map
    // refuses a country it could have guessed at, not merely one nobody
    // reached yet.
    const elsewhere = withConfirmed([
      ...PROFILE_ENTRIES.filter(([key]) => key !== "contact.address"),
      ["contact.address", { line1: "1 Leoforos Example", city: "Nicosia", postalCode: "1010", countryCode: "CY" }],
    ]);
    const plan = planFill(blueprint, check.mappingSet, elsewhere);
    const refused = plan.blockers.find((b) => b.kind === "render_refused");
    expect(refused?.fieldRef).toBe("corrCountry");
    // P116: a French postcode is not a UK one, and the two UK boxes are hidden
    // for a non-UK country — so they are neither filled nor a blocker.
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("corrPostcode");
    expect(plan.blockers.map((b) => b.fieldRef)).not.toContain("corrPostcode2");
    expect(plan.hidden.map((h) => h.fieldRef)).toEqual(expect.arrayContaining(["corrPostcode", "corrPostcode2"]));
  });

  it("name the six Documentary Evidence groups as Vahid read them, and the fourth value is chosen by nothing (P108)", () => {
    // His reading of the live page, 2026-09-12: four values per group —
    // Uploaded, UploadLater, NotSending, NotRequired — the same across all six.
    // *"So for all six: whenDeferred is UploadLater, whenNotProviding is
    // NotSending."* NotRequired is a fourth value: *"Whatever the blueprint
    // does with it, we never choose it."*
    const education = blueprint.pages.find((p) => p.url?.includes("education.do") === true);
    if (education === undefined) expect.unreachable("education page");
    const groups = education.sections.flatMap((s) => s.fields).filter((f) => f.fieldRef.endsWith("Status"));
    expect(groups.map((g) => g.fieldRef)).toEqual([
      "certificateStatus",
      "transcriptStatus",
      "officialCertTranslStatus",
      "officialTranTranslStatus",
      "certificateTranslationStatus",
      "transcriptTranslationStatus",
    ]);
    for (const group of groups) {
      expect(new Set(group.options?.map((o) => o.value)), group.fieldRef).toEqual(new Set(["Uploaded", "UploadLater", "NotSending", "NotRequired"]));
    }
    expect(education.requiredDocuments.map((d) => d.companion)).toEqual(
      groups.map((g) => ({ fieldRef: g.fieldRef, whenAttached: "Uploaded", whenDeferred: "UploadLater", whenNotProviding: "NotSending" })),
    );
    // The two middle groups show NO text beside NotRequired. Recorded as
    // read. That is fine because the option is chosen by nothing — not
    // because there is nothing to say.
    const unlabelled = groups.filter((g) => g.options?.some((o) => o.value === "NotRequired" && o.label === ""));
    expect(unlabelled.map((g) => g.fieldRef)).toEqual(["officialCertTranslStatus", "officialTranTranslStatus"]);
    // Named by nothing: not by a companion, not by a mapping.
    expect(JSON.stringify(education.requiredDocuments)).not.toContain("NotRequired");
    expect(JSON.stringify(mappingSet.mappings)).not.toContain("NotRequired");
  });

  it("name the language page's certificate group as Vahid read it, and NotRequired is named by no companion on any page (P109)", () => {
    // His live reading, 2026-09-12: the same four values as education. His
    // two caveats are honoured: the three label strings his method returned
    // were the parent's text, so the labels here are the capture's per-option
    // read of 2026-09-10, joined to his values by the meaning of the value
    // token — and none of his three strings is recorded as the page's words.
    const language = blueprint.pages.find((p) => p.url?.includes("language.app") === true);
    if (language === undefined) expect.unreachable("language page");
    const fields = language.sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f.fieldRef === "languageCertificateStatus")?.options).toEqual([
      { value: "Uploaded", label: "I will upload my certificate now" },
      { value: "UploadLater", label: "I will upload my certificate later" },
      { value: "NotSending", label: "I will not be providing my certificate" },
      { value: "NotRequired", label: "Not Required" },
    ]);
    expect(fields.find((f) => f.fieldRef === "previousEnglishEducation")?.options?.map((o) => o.value)).toEqual(["Yes", "No"]);
    expect(language.requiredDocuments.map((d) => d.companion)).toEqual([
      { fieldRef: "languageCertificateStatus", whenAttached: "Uploaded", whenDeferred: "UploadLater", whenNotProviding: "NotSending" },
    ]);
    // NotRequired has meant three things on this one form — a claim about
    // the document, about what Sheffield needs, about who the applicant is.
    // The token is the page's; nothing here may act on it. Named by nothing:
    const companions = blueprint.pages.flatMap((p) => p.requiredDocuments.map((d) => d.companion));
    expect(JSON.stringify(companions)).not.toContain("NotRequired");
    expect(JSON.stringify(mappingSet.mappings)).not.toContain("NotRequired");
    // Nothing on the language page is mapped, so its companion is left as the
    // form has it: no instruction on it. Since P126 it carries the third
    // read's observed marker — the row's `*` — and, unmapped, it is a
    // blocker until Iman confirms the mark and the page is mapped; the mark
    // is flagged for him in the review pack, never dropped here.
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, PROFILE);
    // P147 (ADR-0119): the section is optional in Sheffield's words, so the slot
    // is neither handed nor a blocker; it and its companion are left empty and
    // said so. Nothing types the companion, and nothing hands it.
    expect(plan.instructions.some((i) => i.fieldRef === "languageCertificateStatus")).toBe(false);
    expect(plan.blockers.some((b) => b.fieldRef === "languageCertificateStatus" || b.fieldRef === "languageCertificate")).toBe(false);
    expect(plan.handoffs.some((h) => h.fieldRef === "languageCertificateStatus" || h.fieldRef === "languageCertificate")).toBe(false);
    expect(plan.unmapped.map((f) => f.fieldRef)).toContain("languageCertificate");
    expect(plan.unmapped.map((f) => f.fieldRef)).toContain("languageCertificateStatus");
  });

  it("carry the twenty-three groups of personal, contact and nationality as Vahid read them — the case the page's, the five companions three values, NotRequired absent (P110)", () => {
    const options = new Map(
      blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).map((f) => [f.fieldRef, f.options?.map((o) => o.value) ?? []]),
    );
    // personal.do submits capitalised; nationality.do lower-case. *"Same
    // concept, different token, same portal. Any rule that normalises case
    // would be wrong on one of them."*
    expect(options.get("sex")).toEqual(["Female", "Male", "Other"]);
    for (const group of ["takenCourseAtShefUni", "appliedBefore", "nameChanged"]) expect(options.get(group), group).toEqual(["Yes", "No"]);
    // P153 (0.2.26): the nationality page's yes/no radios carry the option
    // labels the third read found ("Yes" / "No"), which P110's rewrite of the
    // values had replaced with the field's own name; the four date selects
    // that share a row with a labelled sibling carry the row's question.
    const all = blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields));
    const labelsOf = (ref: string) => all.find((f) => f.fieldRef === ref)?.options?.map((o) => o.label);
    expect(labelsOf("livedOutsideCountry")).toEqual(["Yes", "No"]);
    expect(labelsOf("previousStudentVisa")).toEqual(["Yes", "No"]);
    expect(labelsOf("passportScanStatus")?.[1]).toBe("I will upload my passport scan later");
    for (const [ref, label] of [["dobMonth", "Date of Birth:*"], ["dobYear", "Date of Birth:*"], ["startYear", "Start Date:*"], ["endYear", "End Date:"]] as const) {
      expect(all.find((f) => f.fieldRef === ref)?.label, ref).toBe(label);
      expect(all.find((f) => f.fieldRef === ref)?.labelSource, `${ref}: the row's text, carried, not read`).toBeUndefined();
    }
    for (const group of [
      "livedOutsideCountry", "alwaysUKResident", "alwaysEUResident", "britishPassport", "indefinateVisa", "refugeeStatus",
      "migrantWorker", "spouseOfUKCitizen", "euPassport", "spouseOfEUCitizen", "livingInUK", "previousStudentVisa",
    ]) expect(options.get(group), group).toEqual(["yes", "no"]);
    expect(options.get("applicationLocation")).toEqual(["Inside UK", "Outside UK"]);
    // The value and the text beside it disagree in a way a reviewer reading
    // the value alone would invert. Recorded so that they cannot.
    const contact = blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).find((f) => f.fieldRef === "corrContactDateType");
    expect(contact?.options).toEqual([
      { value: "Always", label: "Always" },
      { value: "After", label: "From this date:" },
      { value: "Before", label: "To this date:" },
    ]);
    // The five nationality companions: three values, no NotRequired — the
    // token is present on education and language and absent here.
    for (const group of ["passportScanStatus", "visaScanStatus", "utilityBillScanStatus", "proofOfUKSpouseStatus", "refugeeProofStatus"]) {
      expect(options.get(group), group).toEqual(["Uploaded", "UploadLater", "NotSending"]);
    }
    // No slot on nationality has a companion yet: the pairing waits on the
    // file inputs' own handler markup, not on the names.
    const nationality = blueprint.pages.find((p) => p.url?.includes("nationality.do") === true);
    expect(nationality?.requiredDocuments.map((doc) => doc.companion)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("treat nationality's five document slots as off an international student's path — shown only on a claim of UK status (P112)", () => {
    // Vahid read showHideDocumentUploads() from the live page, 2026-09-13:
    // each upload is revealed by a British passport, indefinite leave, a UK
    // spouse or refugee status, and with Iran as nationality and residence
    // none appeared. *"Whatever the draft says about five slots on
    // nationality, it is describing a path our students do not take."*
    const fields = new Map(blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).map((f) => [f.fieldRef, f]));
    expect(fields.get("passportScan")?.visibleWhen).toEqual({ whenFieldRef: "britishPassport", operator: "equals", value: "yes" });
    expect(fields.get("visaScan")?.visibleWhen).toEqual({ whenFieldRef: "indefinateVisa", operator: "equals", value: "yes" });
    expect(fields.get("proofOfUKSpouse")?.visibleWhen).toEqual({ whenFieldRef: "spouseOfUKCitizen", operator: "equals", value: "yes" });
    expect(fields.get("refugeeProof")?.visibleWhen).toEqual({ whenFieldRef: "refugeeStatus", operator: "equals", value: "yes" });
    // The fifth is shown on britishPassport OR indefinateVisa — a disjunction
    // the condition vocabulary cannot say — so it carries no condition and is
    // an optional unmapped field the plan passes over. Recorded, not bent.
    expect(fields.get("utilityBillScan")?.visibleWhen).toBeUndefined();
    // On a plan for an international student none of the UK-status radios is
    // answered, so the four are hidden — as the page hides them — and nothing
    // is mapped to any of the five.
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(blueprint, check.mappingSet, PROFILE);
    const hidden = new Map(plan.hidden.map((h) => [h.fieldRef, h.whenFieldRef]));
    expect(hidden.get("passportScan")).toBe("britishPassport");
    expect(hidden.get("visaScan")).toBe("indefinateVisa");
    expect(hidden.get("proofOfUKSpouse")).toBe("spouseOfUKCitizen");
    expect(hidden.get("refugeeProof")).toBe("refugeeStatus");
    const slots = ["passportScan", "visaScan", "utilityBillScan", "proofOfUKSpouse", "refugeeProof"];
    expect(mappingSet.mappings.filter((m) => slots.includes(m.fieldRef))).toEqual([]);
    expect(plan.uploads.filter((u) => slots.includes(u.fieldRef))).toEqual([]);
    expect(plan.blockers.filter((b) => slots.includes(b.fieldRef))).toEqual([]);
  });

  it("name the education page's listing on summary.do by its numbered heading, exactly (P113, ADR-0106)", () => {
    // Vahid's read, 2026-09-13: the h5 has no class and no id; its wrappers
    // are every section's. The locator names the page's own words and the
    // number, and nothing else; the misspelled wrapper class is kept as
    // written. The runner test on the same shape proves the count is the
    // entries and not the title, the sections, or a substring.
    const education = blueprint.pages.find((p) => p.pageRef === "page7");
    expect(education?.repeats?.recorded).toEqual({
      url: "https://www.sheffield.ac.uk/postgradapplication/summary.do",
      entryLocator: { strategy: "css", value: 'div.homepageInfomation > h5:text-matches("^Previous Education [0-9]+$")' },
    });
  });

  it("record the institution box's entries by value and its escape, so a mapping can name one of two identical texts and never the escape (P118, ADR-0109)", () => {
    const box = blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).find((f) => f.fieldRef === "institution-ts-control");
    expect(box?.inputType).toBe("typeahead");
    expect(box?.typeahead?.escapeValue).toBe("Not in list");
    expect(box?.options?.filter((o) => o.label === "Sheffield International College").map((o) => o.value)).toEqual(["SCH40484", "SHE0512"]);
    expect(box?.options?.find((o) => o.value === "Not in list")?.label).toBe("Not in list");
    // The institution box's entries follow the country box (P102), so naming
    // one means the country box is mapped too — and under ADR-0109 a mapped
    // typeahead records its entries. Since P149 (0.2.24) the draft records the
    // country box's: the captured `<select id="institutionCountry">`'s 255
    // without its blank (P101: value for value, label for label; the count
    // agreed with the dropdown he copied).
    const countrySelect = blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).find((f) => f.fieldRef === "institutionCountry");
    const countryBox = blueprint.pages.flatMap((p) => p.sections.flatMap((s) => s.fields)).find((f) => f.fieldRef === "institutionCountry-ts-control");
    expect(countryBox?.options).toEqual((countrySelect?.options ?? []).filter((o) => o.value.length > 0));
    expect(countryBox?.options).toHaveLength(255);
    // Under the rule, a reviewed constant can name the SECOND of the two: the
    // plan carries its value and the text the runner types. In memory, in
    // place of the draft's own mappings to the two boxes.
    const constant = (fieldRef: string, value: string) => ({
      fieldRef,
      source: { kind: "constant" as const, value, classification: "application_metadata" as const, rationale: "test" },
    });
    const naming = (value: string) => ({
      ...asIfReviewed,
      mappings: [
        ...asIfReviewed.mappings.filter((m) => m.fieldRef !== "institutionCountry-ts-control" && m.fieldRef !== "institution-ts-control"),
        constant("institutionCountry-ts-control", "UNITED KINGDOM"),
        constant("institution-ts-control", value),
      ],
    });
    const second = checkUsable(naming("SHE0512"), blueprint);
    expect(second.usable, second.usable ? "" : second.refusal.detail).toBe(true);
    if (second.usable) {
      const plan = planFill(blueprint, second.mappingSet, withConfirmed([...PROFILE_ENTRIES, ["education.prior_qualifications", [{ level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" }]]]));
      const chosen = plan.instructions.find((i) => i.fieldRef === "institution-ts-control");
      expect(chosen === undefined ? "" : textOf(chosen.value)).toBe("SHE0512");
      expect(chosen?.typeahead?.text).toBe("Sheffield International College");
      expect(chosen?.typeahead?.escapeValue).toBe("Not in list");
      const country = plan.instructions.find((i) => i.fieldRef === "institutionCountry-ts-control");
      expect(country === undefined ? "" : textOf(country.value)).toBe("UNITED KINGDOM");
      expect(country?.typeahead?.text).toBe("United Kingdom");
    }
    // The text as the value: refused. The escape, by its value, which is its own label: refused.
    expect(checkUsable(naming("Sheffield International College"), blueprint).usable).toBe(false);
    const escape = checkUsable(naming("Not in list"), blueprint);
    expect(escape.usable).toBe(false);
    if (!escape.usable) expect(escape.refusal.detail).toContain("escape");
    // And with the country box's entries taken off the draft, a mapping to
    // the institution box is refused: a mapped typeahead records its entries.
    const withoutCountryEntries = {
      ...blueprint,
      pages: blueprint.pages.map((p) => ({
        ...p,
        sections: p.sections.map((s) => ({
          ...s,
          fields: s.fields.map((f) => {
            if (f.fieldRef !== "institutionCountry-ts-control") return f;
            const { options: _entries, ...bare } = f;
            return bare;
          }),
        })),
      })),
    };
    expect(checkUsable(naming("SHE0512"), withoutCountryEntries).usable).toBe(false);
  });

  it("plan each qualification's document radios as UploadLater in the page's own words — six while it is running, four once it has ended (P108, ADR-0138) — and NotRequired appears nowhere", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const withOne = withConfirmed([
      ...PROFILE_ENTRIES,
      [
        "education.prior_qualifications",
        [{ level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "completed", date: { year: 2021, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" }],
      ],
    ]);
    const plan = planFill(blueprint, check.mappingSet, withOne);
    const radios = plan.instructions.filter((i) => i.fieldRef.endsWith("Status") && i.item !== undefined);
    // ═══════════════════════════════════════════════════════════════════
    // FOUR, not six, since ADR-0138 (P187). This qualification is
    // `completed`, and Sheffield shows the proof-of-registration and
    // most-recent-transcript block only while a qualification is still
    // running — so those two slots and their two radios are not planned.
    // Run A's attempt 9 met exactly that: `certificateStatus` refused twice,
    // because the control was not on the page.
    // ═══════════════════════════════════════════════════════════════════
    expect(radios.map((i) => [i.fieldRef, textOf(i.value), i.defers])).toEqual([
      ["officialCertTranslStatus", "UploadLater", "officialCertTranslation"],
      ["officialTranTranslStatus", "UploadLater", "officialTranTranslation"],
      ["certificateTranslationStatus", "UploadLater", "certificateTranslation"],
      ["transcriptTranslationStatus", "UploadLater", "transcriptTranslation"],
    ]);
    // The two that are not planned are RECORDED as not asked for, against the
    // entry's own answer — never dropped silently.
    expect(
      plan.hidden.filter((h) => h.whenEntrySays !== undefined).map((h) => [h.fieldRef, h.whenEntrySays?.part, h.whenEntrySays?.holds]),
    ).toEqual([
      ["certificate", "end.kind", "completed"],
      ["certificateStatus", "end.kind", "completed"],
      ["transcript", "end.kind", "completed"],
      ["transcriptStatus", "end.kind", "completed"],
    ]);
    // A qualification the student has not finished IS asked for both, and all
    // six are planned — the condition is the entry's, answered per entry.
    const studying = withConfirmed([
      ...PROFILE_ENTRIES,
      [
        "education.prior_qualifications",
        [{ level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", start: { year: 2017, month: 9 }, end: { kind: "expected", date: { year: 2027, month: 6 } }, grade: "17.2", gradeScale: "iran_20_point" }],
      ],
    ]);
    const running = planFill(blueprint, check.mappingSet, studying);
    expect(running.instructions.filter((i) => i.fieldRef.endsWith("Status") && i.item !== undefined).map((i) => i.fieldRef)).toEqual([
      "certificateStatus",
      "transcriptStatus",
      "officialCertTranslStatus",
      "officialTranTranslStatus",
      "certificateTranslationStatus",
      "transcriptTranslationStatus",
    ]);
    // ADR-0139: the six slots are named to the student by the PAGE'S own
    // heading — read off each companion row's captured label, and checked by
    // the parser to be its opening words. Four of the six were named by the
    // portal's field name until P188, and two of those named the wrong
    // document: `officialCertTranslation` is the Final Academic Certificate.
    const educationPage = blueprint.pages.find((page) => page.pageRef === "page7");
    expect(educationPage?.requiredDocuments.map((d) => [d.fieldRef, d.title?.text])).toEqual([
      ["certificate", "Proof of Registration"],
      ["transcript", "Most Recent Transcript"],
      ["officialCertTranslation", "Final Academic Certificate"],
      ["officialTranTranslation", "Final Academic Transcript"],
      ["certificateTranslation", "Final Academic Certificate Translation"],
      ["transcriptTranslation", "Final Academic Transcript Translation"],
    ]);
    // What the student is told quotes the page — including the one that
    // says "proof of registration" where the slot says "degree certificate",
    // which is why that pairing is flagged for Iman and not asserted here.
    const told = running.handoffs.filter((h) => h.deferred !== undefined).map((h) => h.deferred?.displayText);
    expect(told).toContain("I will upload proof of registration later");
    expect(told).toContain("I will upload my transcript translation later");
    expect(plan.handoffs.filter((h) => h.deferred !== undefined).map((h) => h.deferred?.displayText), "and not for a finished one").not.toContain(
      "I will upload proof of registration later",
    );
    expect(JSON.stringify([plan.instructions, plan.handoffs, plan.uploads, plan.blockers])).not.toContain("NotRequired");
    expect(JSON.stringify([plan.instructions, plan.handoffs, plan.uploads, plan.blockers])).not.toContain("NotSending");
  });

  it("render the block as decided: the quote on disability, nothing quoted on ethnic origin", () => {
    const page = { ...blueprint, pages: blueprint.pages.filter((p) => p.pageRef === "page9") };
    const onPage = new Set(page.pages.flatMap((p) => p.sections.flatMap((s) => s.fields.map((f) => f.fieldRef))));
    const pageOnly = { ...asIfReviewed, mappings: asIfReviewed.mappings.filter((m) => onPage.has(m.fieldRef)) };
    const check = checkUsable(pageOnly, page);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const plan = planFill(page, check.mappingSet, emptyProfile(studentId("stu"), new Date(0)));
    const preview = buildPreview(page, plan, new Map(), { portalHost: "www.sheffield.ac.uk" });
    if (!preview.built) expect.unreachable(preview.refusal.kind);
    const text = renderPreview(preview.preview);
    expect(text).toContain("We did not answer these for you:");
    expect(text).toContain('The form says: "if you go on to register on a course you will have another opportunity to answer later"');
    expect(text).toContain("Left untouched, as part of this:");
    expect(text).toContain("Learning difference such as dyslexia, dyspraxia or AD(H)D");
    const ethnic = text.slice(text.indexOf("ethnic origin"));
    expect(ethnic).toContain('Instead we entered "Prefer not to say"');
    expect(ethnic).not.toContain("The form says:");
    expect(preview.preview.entries).toHaveLength(0);
    expect(preview.preview.refusals).toHaveLength(2);
  });
});
