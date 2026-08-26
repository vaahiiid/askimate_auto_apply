/**
 * Regression tests for the LWC observer, against the REAL captured markup.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid: *"Use the existing screenshots as the ground truth for your
 * regression tests: the extractor must be able to recover the registration
 * fields that are visibly present in `001-page-1.png`."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The fixture is the `<c-registration>` subtree lifted verbatim from that run,
 * scrubbed of opaque strings for a public repository but structurally
 * untouched. The assertion set is what the screenshot shows.
 *
 * The first test is the whole point: the OLD extractor is run against the same
 * page and must find nothing, because it looks for a `<form>` and Salesforce
 * renders none. If a future change makes both work, that test fails and
 * someone has to decide which observer is correct — rather than the difference
 * quietly disappearing.
 */

import { createServer, type Server } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightInspectionSession } from "./playwright-inspection-session.js";
import type { LwcObservation } from "./lwc-observe-script.js";

const PORT = 4323;
const BASE = `http://127.0.0.1:${String(PORT)}`;

let server: Server;
let traceDir: string;
let observation: LwcObservation;
let legacyFieldCount: number;

/** Exactly what `001-page-1.png` shows, in order. */
const VISIBLE_IN_SCREENSHOT = [
  "First Name",
  "Last Name",
  "Email",
  "Confirm Email",
  "Date of Birth",
  "Password",
  "Confirm Password",
];

beforeAll(async () => {
  const html = await readFile(
    join(import.meta.dirname, "..", "fixtures", "lwc-registration", "registration.html"),
    "utf8",
  );

  server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  traceDir = await mkdtemp(join(tmpdir(), "aas-lwc-"));

  const session = await PlaywrightInspectionSession.open({
    runId: "lwc-fixture-1",
    capability: "read_only",
    allowedHosts: ["127.0.0.1"],
    traceDir,
    navigableUrlPatterns: [/^http:\/\/127\.0\.0\.1:4323\//],
  });
  try {
    await session.goto(`${BASE}/s/login/SelfRegister`);
    await session.settle(4_000);
    observation = await session.observeLwc();
    const legacy = await session.observe();
    legacyFieldCount = legacy.forms.reduce((sum, form) => sum + form.fields.length, 0);
  } finally {
    await session.close();
  }
}, 90_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(traceDir, { recursive: true, force: true });
});

const labels = (): string[] => observation.controls.map((control) => control.label);

describe("the bug this observer exists to fix", () => {
  it("the OLD extractor still finds nothing, because there is no form element", () => {
    // Not a regression guard on the old code — a record of the defect. The
    // page renders nine controls and a form-based extractor reports zero.
    expect(legacyFieldCount).toBe(0);
    expect(observation.formless).toBe(true);
  });

  it("says plainly why, in its own limitations", () => {
    expect(observation.limitations.join(" ")).toContain("no <form> element");
  });
});

describe("recovering the fields visible in 001-page-1.png", () => {
  it("finds every text control the screenshot shows", () => {
    for (const expected of VISIBLE_IN_SCREENSHOT) {
      expect(labels()).toContain(expected);
    }
  });

  it("gets the input types right, including both passwords", () => {
    const byLabel = new Map(observation.controls.map((control) => [control.label, control]));
    expect(byLabel.get("First Name")?.kind).toBe("text");
    expect(byLabel.get("Password")?.kind).toBe("password");
    expect(byLabel.get("Confirm Password")?.kind).toBe("password");
  });

  it("marks the required fields as required, and says how it knows", () => {
    const first = observation.controls.find((control) => control.label === "First Name");
    expect(first?.required).toBe(true);
    expect(first?.requiredSource).toBe("required_attribute");
  });

  it("counts EXACTLY the nine asterisks the screenshot shows", () => {
    // The screenshot marks nine controls with a red asterisk and leaves the
    // marketing checkbox unmarked. Getting this wrong in either direction is
    // consequential: too few and the automation submits an incomplete form;
    // too many and it demands marketing consent a student need not give.
    expect(observation.controls.filter((control) => control.required)).toHaveLength(9);
    const marketing = observation.controls.find(
      (control) => control.kind === "checkbox_group",
    );
    expect(marketing?.required).toBe(false);
  });

  it("finds required-ness on controls that carry no required attribute", () => {
    // Date of Birth and the applicant-type combobox are marked only by an
    // asterisk element beside their wrapper — five and eight levels above the
    // control respectively. Both were missed by earlier attempts.
    const dob = observation.controls.find((control) => control.label === "Date of Birth");
    expect(dob?.required).toBe(true);
    expect(dob?.requiredSource).toBe("asterisk_marker");

    const applicant = observation.controls.find((control) =>
      /type of Applicant/i.test(control.label),
    );
    expect(applicant?.required).toBe(true);
  });

  it("prefers the portal's own data-id over a generated id", () => {
    // lightning-input carries data-id="firstName" / "dateOfBirth" etc:
    // semantic, author-written, and not regenerated the way input-13 is.
    const first = observation.controls.find((control) => control.label === "First Name");
    expect(first?.locators[0]).toBe('[data-id="firstName"]');
    expect(first?.stability).toBe("stable");

    const dob = observation.controls.find((control) => control.label === "Date of Birth");
    expect(dob?.locators[0]).toBe('[data-id="dateOfBirth"]');
  });

  it("captures the date-range constraint on Date of Birth", () => {
    // "Select a date before 31 Dec 2009" is a real validation rule AND an age
    // constraint the interview needs to know about.
    const dob = observation.controls.find((control) => control.label === "Date of Birth");
    expect(dob?.helpText.join(" ")).toMatch(/before 31 Dec 2009/i);
  });

  it("finds BOTH dropdowns", () => {
    const comboboxes = observation.controls.filter((control) => control.kind === "combobox");
    expect(comboboxes.length).toBeGreaterThanOrEqual(2);

    const text = comboboxes.map((control) => control.label).join(" | ");
    expect(text).toMatch(/type of Applicant/i);
    expect(text).toMatch(/heard about us/i);
  });

  it("reports dropdown options as UNAVAILABLE rather than guessing or clicking", () => {
    // The listbox is empty until the control is opened, and opening it is an
    // interaction this observer will never perform.
    const combobox = observation.controls.find((control) => control.kind === "combobox");
    expect(combobox?.options).toBeUndefined();
    expect(combobox?.optionsUnavailable).toContain("clicking");
  });

  it("finds the marketing checkbox group", () => {
    const groups = observation.controls.filter((control) => control.kind === "checkbox_group");
    expect(groups.length).toBeGreaterThanOrEqual(1);
    expect(groups.map((group) => group.label).join(" ")).toMatch(/marketing/i);
  });

  it("finds the Create Account button and sees that it is disabled", () => {
    const create = observation.buttons.find((button) => /create account/i.test(button.text));
    expect(create).toBeDefined();
    // The screenshot shows it greyed out until the form is valid.
    expect(create?.disabled).toBe(true);
  });

  it("finds the Privacy Notice and UKCISA links", () => {
    const text = observation.links.map((link) => link.text).join(" | ");
    expect(text).toMatch(/privacy notice/i);
    expect(text).toMatch(/UKCISA|International Student Affairs/i);
  });

  it("captures the password policy as instruction text", () => {
    const all = observation.instructions.join(" ");
    expect(all).toMatch(/8 characters/);
    expect(all).toMatch(/1 number/);
    expect(all).toMatch(/1 symbol/);
  });

  it("captures the welcome-email statement", () => {
    expect(observation.instructions.join(" ")).toMatch(/welcome email/i);
  });

  it("captures the applicant-type guidance, which a student will need", () => {
    const all = observation.instructions.join(" ");
    expect(all).toMatch(/Domestic\/Home|International/);
  });
});

describe("what the observer says about locating these fields later", () => {
  it("records that no control carries a usable name attribute", () => {
    // Two comboboxes DO have a name — `name="progress"`, which the framework
    // reuses and which identifies nothing. That is worse than absent: it looks
    // like a locator. The seven real inputs have no name at all.
    const inputs = observation.controls.filter((control) =>
      ["text", "password", "email", "date"].includes(control.kind),
    );
    expect(inputs.filter((control) => control.name !== undefined)).toHaveLength(0);
    expect(observation.limitations.join(" ")).toContain("no usable name attribute");
  });

  it("offers a placeholder-based locator, since ids are regenerated", () => {
    const first = observation.controls.find((control) => control.label === "First Name");
    expect(first?.locators).toContain('[placeholder="First Name"]');
    expect(first?.id).toMatch(/^input-\d+$/);
  });

  it("records where each label came from, so evidence can be weighed", () => {
    // "First Name" read from a placeholder is not the same quality of evidence
    // as one read from a <label for>, and a mapping specialist needs to know.
    const sources = new Set(observation.controls.map((control) => control.labelSource));
    expect(sources.has("none")).toBe(false);
    const first = observation.controls.find((control) => control.label === "First Name");
    expect(["label_for", "component_label", "placeholder"]).toContain(first?.labelSource);
  });

  it("records the component ancestry of each control", () => {
    const first = observation.controls.find((control) => control.label === "First Name");
    expect(first?.componentPath.join(" > ")).toMatch(/lightning-input|lightning-primitive/);
  });

  it("reports the component structure of the page", () => {
    const tags = observation.components.map((component) => component.tag);
    expect(tags).toContain("lightning-input");
    expect(tags.some((tag) => tag.startsWith("c-"))).toBe(true);
  });
});

describe("the observer never acts", () => {
  it("exposes no method that could fill, click, upload or submit", () => {
    const surface = Object.getOwnPropertyNames(PlaywrightInspectionSession.prototype);
    for (const forbidden of ["fill", "click", "type", "press", "upload", "submit", "setInputFiles"]) {
      expect(surface).not.toContain(forbidden);
    }
  });

  it("leaves the disabled Create Account button disabled", () => {
    // A guard against an observer that "helpfully" fills fields to see what
    // validation says. Nothing was typed, so the button is still inert.
    const create = observation.buttons.find((button) => /create account/i.test(button.text));
    expect(create?.disabled).toBe(true);
  });
});
