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
import { checkUsable, planFill, textOf } from "@askimate/aas-mapping";
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
    // job), and the four employment fields have no mapping because the
    // registry has no field for them (P89, raised) — and NOTHING else blocks:
    // no covered control, no unclassified field, no refused render.
    expect(new Set(plan.blockers.map((b) => b.kind))).toEqual(new Set(["value_unavailable", "no_mapping"]));
    expect(plan.blockers.filter((b) => b.kind === "no_mapping").map((b) => b.fieldRef).sort()).toEqual([
      "duties",
      "employerDetails",
      "position",
      "startMonth",
    ]);
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
    expect(typed.get("corrPostcode")).toBe("S10 2TN");
    // P90: the international postcode box is hidden for a UK address, so it
    // is neither filled nor missing — the form does not show it.
    expect(typed.has("corrIntlPostcode")).toBe(false);
    expect(plan.hidden.map((h) => h.fieldRef)).toContain("corrIntlPostcode");
    expect(plan.blockers.map((b) => b.kind)).toEqual(["no_mapping", "no_mapping", "no_mapping", "no_mapping"]);
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
    const elsewhere = withConfirmed([
      ...PROFILE_ENTRIES.filter(([key]) => key !== "contact.address"),
      ["contact.address", { line1: "1 Rue Example", city: "Lyon", postalCode: "69001", countryCode: "FR" }],
    ]);
    const plan = planFill(blueprint, check.mappingSet, elsewhere);
    const refused = plan.blockers.find((b) => b.kind === "render_refused");
    expect(refused?.fieldRef).toBe("corrCountry");
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

  it("plan each qualification's six radios as UploadLater in the page's own words, and NotRequired appears nowhere (P108)", () => {
    const check = checkUsable(asIfReviewed, blueprint);
    if (!check.usable) expect.unreachable(check.refusal.kind);
    const withOne = withConfirmed([
      ...PROFILE_ENTRIES,
      [
        "education.prior_qualifications",
        [{ level: "Bachelor's degree", subject: "Industrial Engineering", institution: "Sharif University of Technology", countryCode: "IR", completionYear: 2021, grade: "17.2", gradeScale: "iran_20_point" }],
      ],
    ]);
    const plan = planFill(blueprint, check.mappingSet, withOne);
    const radios = plan.instructions.filter((i) => i.fieldRef.endsWith("Status") && i.item !== undefined);
    expect(radios.map((i) => [i.fieldRef, textOf(i.value), i.defers])).toEqual([
      ["certificateStatus", "UploadLater", "certificate"],
      ["transcriptStatus", "UploadLater", "transcript"],
      ["officialCertTranslStatus", "UploadLater", "officialCertTranslation"],
      ["officialTranTranslStatus", "UploadLater", "officialTranTranslation"],
      ["certificateTranslationStatus", "UploadLater", "certificateTranslation"],
      ["transcriptTranslationStatus", "UploadLater", "transcriptTranslation"],
    ]);
    // What the student is told quotes the page — including the one that
    // says "proof of registration" where the slot says "degree certificate",
    // which is why that pairing is flagged for Iman and not asserted here.
    const told = plan.handoffs.filter((h) => h.deferred !== undefined).map((h) => h.deferred?.displayText);
    expect(told).toContain("I will upload proof of registration later");
    expect(told).toContain("I will upload my transcript translation later");
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
