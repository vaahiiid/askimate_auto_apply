/**
 * The row's question and the bare asterisk, read where the markup ties nothing
 * (P123, distance item 1).
 *
 * Vahid's attached read of Sheffield's five unlabelled pages (2026-09-14,
 * commit b338705) came back as the first one had: the label as the field's
 * name on 139 of 149 fields, no asterisk anywhere, no field required — because
 * the observer resolves a label through `label[for]`, a wrapping `<label>` or
 * `aria-label`, and those pages use none. He said what the markup does instead:
 * the question in the row's first cell, a bare `<font>*</font>` tied to nothing,
 * empty `labels` and `labelFor` on every control. This fixture is in THAT shape
 * — his description, not Sheffield's markup, which is not in this repository —
 * and the observer must read the question from the row, mark the asterisk with
 * its own source, and leave a row that names no question alone.
 */

import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseBlueprint } from "@askimate/aas-catalogue";
import { GATED_PORTAL_BLUEPRINT } from "@askimate/aas-mapping/fixtures/gated";

import { pageFrom } from "./discovery.js";
import { OBSERVE_SCRIPT, type RawObservation } from "./observe-script.js";
import type { PageObservation } from "./session.js";

const PAGE = `<!doctype html><html><body>
<form method="post" action="/nationality.do">
<table>
  <tr><td>Which country were you born in?<font>*</font></td>
      <td><select name="countryOfBirth" id="countryOfBirth"><option value=""></option><option value="GB:H">United Kingdom</option><option value="IR:O">Iran</option></select></td></tr>
  <tr><td>Have you always lived in the UK?<font>*</font></td>
      <td><input type="radio" name="alwaysUKResident" value="yes"> yes <input type="radio" name="alwaysUKResident" value="no"> no</td></tr>
  <tr><td>When did you enter the UK?</td>
      <td><select name="dateEnteredUKDay"><option>1</option><option>2</option></select>
          <select name="dateEnteredUKMonth"><option>January</option></select>
          <select name="dateEnteredUKYear"><option>2024</option></select></td></tr>
  <tr><td><select name="previousCountry1"><option value=""></option><option value="AFGHANISTAN:O">Afghanistan</option><option value="ALBANIA:O">Albania</option></select></td></tr>
  <tr><td>Please enter your passport number below. This is required in order to comply with UK immigration law.<font>*</font></td>
      <td><input type="text" name="passportNumber" maxlength="30"></td></tr>
  <tr><td>Your middle name</td><td><input type="text" name="middleName"></td></tr>
  <tr><td><label for="nationalInsurance">National Insurance number</label><font>*</font></td><td><input type="text" id="nationalInsurance" name="nationalInsurance"></td></tr>
  <tr><td><label for="gradeNote"></label>Grade, as shown on the certificate</td><td><input type="text" id="gradeNote" name="gradeNote"></td></tr>
  <tr><td>Select the country the institution is based in: <select name="institutionCountry"><option>Iran</option></select>
          Select the institution: <select name="institutionCode"><option>Sharif</option></select>
          If it is not listed, enter it here: <input type="text" name="unlistedInstitution"></td></tr>
  <tr><td>What is your nationality for funding purposes?<font>*</font></td></tr>
  <tr><td><select name="fundingNationality"><option value="">-</option><option value="IR:O">Iranian</option></select></td></tr>
  <tr><td>How many years have you held a Student Visa?</td></tr>
  <tr><td><select name="yearsOnStudentVisa"><option>0</option></select> <select name="monthsOnStudentVisa"><option>0</option></select></td></tr>
</table>
<div id="uploads" style="display:none">
  <table>
    <tr><td>If you hold a full UK passport please provide a scan of your passport</td>
        <td><input type="file" name="passportScan">
            <input type="radio" name="passportScanStatus" value="Uploaded"> I will upload my passport scan now
            <input type="radio" name="passportScanStatus" value="NotSending"> I will not be providing my passport scan
            <!-- <br/> <input type="radio" name="passportScanStatus" value="Later"> I will upload my passport scan later --></td></tr>
  </table>
</div>
<input type="submit" value="Save and continue">
</form></body></html>`;

let browser: Browser;
let observation: RawObservation;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(PAGE);
  observation = await page.evaluate(OBSERVE_SCRIPT);
  await page.close();
}, 60_000);

afterAll(async () => {
  await browser.close();
});

const field = (name: string) => observation.forms[0]?.fields.find((f) => f.name === name);

describe("the observer, on a page in the shape Vahid described", () => {
  it("reads the row's question as context where the markup ties no label, and never as a label", () => {
    const country = field("countryOfBirth");
    expect(country?.label).toBeUndefined();
    expect(country?.context).toBe("Which country were you born in?");
    expect(country?.marked).toBe(true);
  });

  it("strips the marker from the text and keeps it as a fact of its own; an unmarked row is not marked", () => {
    expect(field("passportNumber")?.context).toBe(
      "Please enter your passport number below. This is required in order to comply with UK immigration law.",
    );
    expect(field("passportNumber")?.marked).toBe(true);
    expect(field("middleName")?.context).toBe("Your middle name");
    expect(field("middleName")?.marked).toBeUndefined();
  });

  it("gives every control in a row the row's one question — a date asked as three selects shares it", () => {
    for (const name of ["dateEnteredUKDay", "dateEnteredUKMonth", "dateEnteredUKYear"]) {
      expect(field(name)?.context, name).toBe("When did you enter the UK?");
    }
  });

  it("does NOT invent a question for a row that names none — the country list is not the question", () => {
    const previous = field("previousCountry1");
    expect(previous?.context).toBeUndefined();
    expect(previous?.marked).toBeUndefined();
  });

  it("keeps a tied label as the label, and still reads the row's marker", () => {
    const ni = field("nationalInsurance");
    expect(ni?.label).toBe("National Insurance number");
    expect(ni?.context).toBeUndefined();
    expect(ni?.marked).toBe(true);
  });

  it("treats a tied label with no words as no label, and reads the row instead", () => {
    // The 2026-09-14 read carried one such field on the education page: an
    // empty `<label for>` that out-ranked everything and left the field with
    // an empty label a reviewed entry would refuse.
    const grade = field("gradeNote");
    expect(grade?.label).toBeUndefined();
    expect(grade?.context).toBe("Grade, as shown on the certificate");
  });

  it("labels each control in a row that asks several things by its OWN words, not the row's first question", () => {
    // The 2026-09-14 re-read gave the education page's institution box and
    // its unlisted-institution box the country question, because the rule
    // took the row's text before its first control for every control in it.
    expect(field("institutionCountry")?.context).toBe("Select the country the institution is based in:");
    expect(field("institutionCode")?.context).toBe("Select the institution:");
    expect(field("unlistedInstitution")?.context).toBe("If it is not listed, enter it here:");
  });

  it("reads a question ROW above a row that holds only controls, marker included; several controls share it", () => {
    // The re-read left the nationality page's top selects unlabelled and
    // unmarked: their question is a row of its own above the control's row.
    expect(field("fundingNationality")?.context).toBe("What is your nationality for funding purposes?");
    expect(field("fundingNationality")?.marked).toBe(true);
    expect(field("yearsOnStudentVisa")?.context).toBe("How many years have you held a Student Visa?");
    expect(field("monthsOnStudentVisa")?.context).toBe("How many years have you held a Student Visa?");
    expect(field("yearsOnStudentVisa")?.marked).toBeUndefined();
  });

  it("gives a radio its own words from the text after it, and the group the row's question", () => {
    const radios = observation.forms[0]?.fields.filter((f) => f.name === "alwaysUKResident") ?? [];
    expect(radios.map((r) => r.textAfter)).toEqual(["yes", "no"]);
    expect(radios.map((r) => r.context)).toEqual(["Have you always lived in the UK?", "Have you always lived in the UK?"]);
    expect(radios.map((r) => r.marked)).toEqual([true, true]);
  });

  it("reads a hidden block as it reads a shown one: the condition in the portal's words, no marker", () => {
    expect(field("passportScan")?.context).toBe("If you hold a full UK passport please provide a scan of your passport");
    expect(field("passportScan")?.marked).toBeUndefined();
    const statuses = observation.forms[0]?.fields.filter((f) => f.name === "passportScanStatus") ?? [];
    expect(statuses.map((s) => s.textAfter)).toEqual([
      "I will upload my passport scan now",
      "I will not be providing my passport scan",
    ]);
  });

  it("does NOT read a commented-out control as a radio's words — the re-read carried one on every companion", () => {
    // Vahid's re-read (9a3a1db): the five companions' "later" option labels
    // ended `... later <br/> <input type="radio" name="passportSca` — the
    // text of a comment node after the radio, which is markup Sheffield
    // switched off, not a word the student sees.
    const statuses = observation.forms[0]?.fields.filter((f) => f.name === "passportScanStatus") ?? [];
    expect(statuses.map((s) => s.textAfter)).toEqual([
      "I will upload my passport scan now",
      "I will not be providing my passport scan",
    ]);
    expect(statuses).toHaveLength(2);
  });
});

describe("the draft that read produces", () => {
  const page = () =>
    pageFrom(
      {
        url: "https://portal.test/nationality.do",
        title: "Nationality",
        observedAt: new Date(0),
        forms: observation.forms,
        candidateAdvanceControls: observation.candidateAdvanceControls,
        signals: observation.signals,
      } satisfies PageObservation,
      "nationality",
    );
  const drafted = (ref: string) => page().sections[0]?.fields.find((f) => f.fieldRef === ref);

  it("labels a field from the row and SAYS so; marks the asterisk with its own source", () => {
    const country = drafted("countryOfBirth");
    expect(country?.label).toBe("Which country were you born in?");
    expect(country?.labelSource).toBe("row_text");
    expect(country?.validations).toEqual([{ kind: "required", source: "observed_marker" }]);
  });

  it("leaves a row that names no question with the field's name, unlabelled and unmarked", () => {
    const previous = drafted("previousCountry1");
    expect(previous?.label).toBe("previousCountry1");
    expect(previous?.labelSource).toBeUndefined();
    expect(previous?.validations).toEqual([]);
  });

  it("names a radio group by the row's question and its options by their own words", () => {
    const group = drafted("alwaysUKResident");
    expect(group?.label).toBe("Have you always lived in the UK?");
    expect(group?.labelSource).toBe("row_text");
    expect(group?.options).toEqual([
      { value: "yes", label: "yes" },
      { value: "no", label: "no" },
    ]);
    expect(group?.validations).toEqual([{ kind: "required", source: "observed_marker" }]);
    const status = drafted("passportScanStatus");
    expect(status?.options?.map((o) => o.label)).toEqual([
      "I will upload my passport scan now",
      "I will not be providing my passport scan",
    ]);
    expect(status?.validations).toEqual([]);
  });

  it("a tied label keeps no labelSource, and an attribute beats the marker as the source", () => {
    const ni = drafted("nationalInsurance");
    expect(ni?.label).toBe("National Insurance number");
    expect(ni?.labelSource).toBeUndefined();
    expect(ni?.validations).toEqual([{ kind: "required", source: "observed_marker" }]);
  });

  it("is accepted by the catalogue parser with both new facts, and a labelSource the vocabulary does not have is refused", () => {
    const reviewed = JSON.parse(JSON.stringify(GATED_PORTAL_BLUEPRINT)) as { pages: { sections: { fields: Record<string, unknown>[] }[] }[] };
    const first = reviewed.pages[0]?.sections[0]?.fields[0];
    if (first === undefined) expect.unreachable("the fixture blueprint has fields");
    first["labelSource"] = "row_text";
    first["validations"] = [{ kind: "required", source: "observed_marker" }];
    expect(parseBlueprint(reviewed).ok).toBe(true);
    first["labelSource"] = "markup";
    const refused = parseBlueprint(reviewed);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.refusal.path).toContain("labelSource");
  });
});
