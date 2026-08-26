/**
 * A small reviewed blueprint and a mapping set for it.
 *
 * Shaped like a real postgraduate application page rather than a minimal
 * example: a date the portal writes its own way, a nationality dropdown with
 * the university's own vocabulary, a document upload, a declaration only the
 * student may tick, and a course code that is not the student's data.
 *
 * Each of those exists because it is where a mapping goes wrong in practice.
 */

import type { ApplicationBlueprint, BlueprintId } from "@askimate/aas-blueprint";

import type { MappingSet } from "../mapping.js";

const DISCOVERED_AT = new Date("2026-08-20T09:00:00Z");
const REVIEWED_AT = new Date("2026-08-21T14:00:00Z");

export const FIXTURE_BLUEPRINT: ApplicationBlueprint = {
  blueprintId: "bp-fixture-pg" as BlueprintId,
  version: "1.0.0",
  status: "reviewed",
  institutionName: "Example University",
  campus: "City",
  courseName: "MSc Example Studies",
  intake: "September 2026",
  route: "direct_portal",
  authentication: {
    required: true,
    loginUrl: "https://apply.example.test/login",
    accountCreationRequired: true,
    notes: "Applicant account with email verification.",
  },
  pages: [
    {
      pageRef: "page-personal",
      title: "Personal details",
      url: "https://apply.example.test/personal",
      sections: [
        {
          sectionRef: "sec-name",
          title: "Your name",
          fields: [
            {
              fieldRef: "given_name",
              label: "First name",
              inputType: "text",
              locators: [{ strategy: "label", value: "First name" }],
              validations: [{ kind: "required", source: "dom_attribute" }],
            },
            {
              fieldRef: "family_name",
              label: "Last name",
              inputType: "text",
              locators: [{ strategy: "label", value: "Last name" }],
              validations: [{ kind: "required", source: "dom_attribute" }],
            },
            {
              fieldRef: "preferred_name",
              label: "Preferred name (optional)",
              inputType: "text",
              locators: [{ strategy: "label", value: "Preferred name (optional)" }],
              validations: [],
            },
          ],
        },
        {
          sectionRef: "sec-identity",
          title: "Identity",
          fields: [
            {
              fieldRef: "dob",
              label: "Date of birth",
              inputType: "text",
              locators: [{ strategy: "label", value: "Date of birth" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "pattern", value: "\\d{2}/\\d{2}/\\d{4}", source: "dom_attribute" },
              ],
            },
            {
              fieldRef: "nationality",
              label: "Nationality",
              inputType: "select",
              locators: [{ strategy: "label", value: "Nationality" }],
              validations: [{ kind: "required", source: "dom_attribute" }],
              options: [
                { value: "IR", label: "Iran (Islamic Republic of)" },
                { value: "IQ", label: "Iraq" },
                { value: "GB", label: "United Kingdom" },
              ],
            },
            {
              fieldRef: "email",
              label: "Email address",
              inputType: "email",
              locators: [{ strategy: "label", value: "Email address" }],
              validations: [{ kind: "required", source: "dom_attribute" }],
            },
          ],
        },
      ],
      requiredDocuments: [],
      advanceControl: { strategy: "role", value: "button:Continue" },
      nextPageRef: "page-course",
    },
    {
      pageRef: "page-course",
      title: "Course and documents",
      url: "https://apply.example.test/course",
      sections: [
        {
          sectionRef: "sec-course",
          title: "Your course",
          fields: [
            {
              fieldRef: "course_code",
              label: "Course code",
              inputType: "text",
              locators: [{ strategy: "label", value: "Course code" }],
              validations: [{ kind: "required", source: "dom_attribute" }],
            },
            {
              fieldRef: "personal_statement",
              label: "Why do you want to study this course?",
              inputType: "textarea",
              locators: [{ strategy: "label", value: "Why do you want to study this course?" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "maxlength", value: "4000", source: "dom_attribute" },
              ],
            },
            {
              fieldRef: "passport_upload",
              label: "Upload your passport",
              inputType: "file",
              locators: [{ strategy: "label", value: "Upload your passport" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "accept", value: ".pdf,.jpg,.png", source: "dom_attribute" },
              ],
            },
            {
              fieldRef: "declaration",
              label: "I declare that the information given is true and complete",
              inputType: "checkbox",
              locators: [
                { strategy: "label", value: "I declare that the information given is true and complete" },
              ],
              validations: [{ kind: "required", source: "dom_attribute" }],
            },
          ],
        },
      ],
      requiredDocuments: [
        {
          documentRef: "passport",
          label: "Passport",
          acceptedFormats: [".pdf", ".jpg", ".png"],
          required: true,
        },
      ],
    },
  ],
  handoffPoints: [
    {
      pageRef: "page-course",
      kind: "legal_declaration",
      description: "The applicant must tick the declaration themselves.",
    },
  ],
  provenance: {
    discoveryRunId: "run-fixture-1",
    discoveredAt: DISCOVERED_AT,
    observedUrls: ["https://apply.example.test/personal", "https://apply.example.test/course"],
    reviewedBy: "specialist-a",
    reviewedAt: REVIEWED_AT,
    unobservedClaims: [],
  },
};

/** A complete, reviewed mapping set for the fixture blueprint. */
export const FIXTURE_MAPPING_SET: MappingSet = {
  mappingSetId: "map-fixture-pg",
  version: "1.0.0",
  status: "reviewed",
  blueprintId: "bp-fixture-pg",
  blueprintVersion: "1.0.0",
  authoredBy: "specialist-a",
  reviewedBy: "specialist-b",
  authoredAt: new Date("2026-08-22T09:00:00Z"),
  reviewedAt: new Date("2026-08-22T16:00:00Z"),
  mappings: [
    {
      fieldRef: "given_name",
      source: { kind: "profile_field", fieldKey: "identity.given_name", format: { kind: "text" } },
    },
    {
      fieldRef: "family_name",
      source: { kind: "profile_field", fieldKey: "identity.family_name", format: { kind: "text" } },
    },
    {
      fieldRef: "dob",
      source: {
        kind: "profile_field",
        fieldKey: "identity.date_of_birth",
        // The portal's pattern attribute says DD/MM/YYYY. Recorded from the
        // blueprint's observed validation, not assumed from the campus country.
        format: { kind: "date", pattern: "DD/MM/YYYY" },
      },
      note: "Portal pattern attribute is \\d{2}/\\d{2}/\\d{4}; confirmed British order on review.",
    },
    {
      fieldRef: "nationality",
      source: {
        kind: "profile_field",
        fieldKey: "identity.nationality",
        // Mapped to the portal's own option values. Anything not listed here
        // stops the run rather than being approximated.
        format: {
          kind: "option",
          options: {
            Iranian: "IR",
            Iraqi: "IQ",
            British: "GB",
          },
        },
      },
    },
    {
      fieldRef: "email",
      source: { kind: "profile_field", fieldKey: "contact.email", format: { kind: "text" } },
    },
    {
      fieldRef: "personal_statement",
      source: {
        kind: "profile_field",
        fieldKey: "study.personal_statement",
        format: { kind: "text" },
      },
    },
    {
      fieldRef: "course_code",
      source: {
        kind: "constant",
        value: "PG-EX-2026",
        classification: "application_metadata",
        rationale:
          "The course code for MSc Example Studies, September 2026 intake. Taken from the " +
          "university's own course listing; identical for every applicant to this course.",
      },
    },
    {
      fieldRef: "passport_upload",
      source: { kind: "document", documentRef: "passport" },
    },
    {
      fieldRef: "declaration",
      source: {
        kind: "student_handoff",
        reason:
          "A legal declaration. Brief §7 — the student ticks this themselves, and the system " +
          "must never tick it for them.",
      },
    },
    // `preferred_name` is deliberately unmapped: it is optional, and leaving an
    // optional field blank is correct rather than a gap.
  ],
};
