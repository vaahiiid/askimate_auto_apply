/**
 * A reviewed blueprint for a portal that actually requires an account.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `FIXTURE_BLUEPRINT` beside this one says `authentication.required: false`,
 * and the comment there records why: it claimed the opposite until the
 * orchestrator's account stage landed and correctly demanded an account for a
 * portal that has none. It was describing a portal that did not exist.
 *
 * This blueprint describes one that does — `startFixturePortal` in
 * `apps/browser-runner` — and it is the first blueprint in this repository for
 * which the secure interaction is genuinely REQUIRED rather than optional. The
 * form is unreachable without a session, the session is unreachable without an
 * account, and the account is unreachable without a password.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The URLs have a placeholder origin, on purpose ────────────────────────
 *
 * The portal listens on an ephemeral port, so its origin is not known until it
 * starts. The blueprint records `https://gated.portal.test`, and a run swaps
 * the origin the same way a replay does — the PATHS are what a blueprint is
 * about, and rewriting one to match a port would be testing against a different
 * blueprint from the one a specialist reviewed.
 */

import type { ApplicationBlueprint, BlueprintId } from "@askimate/aas-blueprint";

import type { MappingSet } from "../mapping.js";

const DISCOVERED_AT = new Date("2026-08-30T09:00:00Z");
const REVIEWED_AT = new Date("2026-08-30T15:00:00Z");

/** The origin a run replaces with the portal's real one. */
export const GATED_PORTAL_ORIGIN = "https://gated.portal.test";

export const GATED_PORTAL_BLUEPRINT: ApplicationBlueprint = {
  blueprintId: "bp-gated-portal" as BlueprintId,
  version: "1.0.0",
  status: "reviewed",
  institutionName: "Gated University",
  campus: "Main",
  courseName: "MSc Controlled Studies",
  intake: "September 2026",
  route: "direct_portal",
  authentication: {
    required: true,
    loginUrl: `${GATED_PORTAL_ORIGIN}/login`,
    // The login form's controls, for the resume path (ADR-0101 §3). Recorded
    // from the page `loginUrl` names, exactly as the fixture portal renders it.
    login: {
      emailLocator: { strategy: "label", value: "Email address" },
      passwordLocator: { strategy: "label", value: "Password" },
      submitLocator: { strategy: "role", value: "button:Sign in" },
    },
    accountCreationRequired: true,
    notes:
      "The application form redirects to /register without a session. The applicant chooses " +
      "their own password at registration, and the form asks for it twice.",
  },
  pages: [
    {
      pageRef: "page-register",
      title: "Create your account",
      url: `${GATED_PORTAL_ORIGIN}/register`,
      sections: [
        {
          sectionRef: "sec-credentials",
          title: "Your sign-in details",
          fields: [
            {
              fieldRef: "account_email",
              label: "Email address",
              inputType: "email",
              locators: [{ strategy: "label", value: "Email address" }],
              validations: [{ kind: "required", source: "dom_attribute" }],
            },
            // The two password fields are recorded, because a blueprint
            // describes the page. Note that NEITHER appears in the mapping set:
            // a password is not profile data and has no mapping, and the only
            // thing that may type into these is the Secure Plane's fill agent.
            //
            // ── Located by NAME, not by label, and that is a finding ──────
            //
            // The first version of this blueprint used `label: "Password"`, and
            // the test that resolves every locator against the real page failed
            // with "expected 2 to be 1": `getByLabel` is non-exact by design, so
            // "Password" matches "Confirm password" as well.
            //
            // On any other field an ambiguous locator is a bug. On this one it
            // is the bug that types a credential into the wrong box — and the
            // fill agent takes ONE locator, so there is no list for it to fall
            // through. `name` is also what discovery's own observer records for
            // a password field, so this is the locator a specialist would have
            // written down anyway.
            {
              fieldRef: "account_password",
              label: "Password",
              inputType: "password",
              locators: [{ strategy: "name", value: "password" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "minlength", value: "8", source: "dom_attribute" },
              ],
            },
            {
              fieldRef: "account_password_confirm",
              label: "Confirm password",
              inputType: "password",
              locators: [{ strategy: "name", value: "password_confirm" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "minlength", value: "8", source: "dom_attribute" },
              ],
            },
          ],
        },
      ],
      requiredDocuments: [],
      advanceControl: { strategy: "role", value: "button:Create account" },
      nextPageRef: "page-application",
    },
    {
      pageRef: "page-application",
      title: "Your application",
      url: `${GATED_PORTAL_ORIGIN}/apply`,
      sections: [
        {
          sectionRef: "sec-personal",
          title: "Personal details",
          fields: [
            {
              fieldRef: "given_name",
              label: "First name",
              inputType: "text",
              locators: [{ strategy: "label", value: "First name" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "maxlength", value: "50", source: "dom_attribute" },
              ],
            },
            {
              fieldRef: "family_name",
              label: "Last name",
              inputType: "text",
              locators: [{ strategy: "label", value: "Last name" }],
              validations: [
                { kind: "required", source: "dom_attribute" },
                { kind: "maxlength", value: "50", source: "dom_attribute" },
              ],
            },
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
          ],
        },
      ],
      requiredDocuments: [],
      advanceControl: { strategy: "role", value: "button:Save and continue" },
      nextPageRef: "page-study",
    },
    {
      // ── The second application page ────────────────────────────────────
      //
      // Real applications are paginated, and this fixture is paginated because
      // of it: page one being SAVED is what makes page two reachable, so a run
      // that lost track of which pages it had done would either stall on an
      // unreachable page or re-save one it had already saved. ADR-0047 is the
      // mechanism that stops both, and this page is what exercises it.
      pageRef: "page-study",
      title: "Your course",
      url: `${GATED_PORTAL_ORIGIN}/study`,
      sections: [
        {
          sectionRef: "sec-study",
          title: "Your course",
          fields: [
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
          ],
        },
      ],
      requiredDocuments: [],
      advanceControl: { strategy: "role", value: "button:Save and continue" },
    },
  ],
  handoffPoints: [],
  submission: {
    pageRef: "page-study",
    // Recorded so the run KNOWS what it must not press. ADR-0014: discovery
    // cannot submit, and neither can preparation — `FillableSession` has no
    // `submit`, and this entry is what a guard checks a click against.
    submitControl: { strategy: "css", value: "#submitBtn" },
    confirmationIndicators: ["Application submitted."],
  },
  provenance: {
    discoveryRunId: "run-gated-1",
    discoveredAt: DISCOVERED_AT,
    observedUrls: [
      `${GATED_PORTAL_ORIGIN}/register`,
      `${GATED_PORTAL_ORIGIN}/apply`,
      `${GATED_PORTAL_ORIGIN}/study`,
    ],
    reviewedBy: "specialist-a",
    reviewedAt: REVIEWED_AT,
    unobservedClaims: [],
  },
};

/**
 * The mapping set — including the two password fields, as ADR-0043 requires.
 *
 * ── What a reviewer is approving for those two ────────────────────────────
 *
 * Not a data route. `{ kind: "secure_credential", purpose }` has no `fieldKey`,
 * no `value` and no `format`; a compile-time assertion in `mapping.ts` fails
 * the build if a field is ever added that could hold one. What the second
 * specialist checks is "yes, the Secure Plane fills this, for account
 * creation" — and the check is enforced BOTH ways by `checkUsable`: a password
 * field may have only this source, and this source may target only a password
 * field.
 *
 * The first version of this file left both fields unmapped, which read as the
 * safer choice and was not: `planFill` produced a `no_mapping` blocker for a
 * required field, and the run stopped for a specialist who had nothing to
 * decide. An absent mapping did not mean "the Secure Plane handles it" — it
 * meant "nobody has thought about this yet", which is a different thing.
 */
export const GATED_PORTAL_MAPPING_SET: MappingSet = {
  mappingSetId: "map-gated-portal",
  version: "1.0.0",
  status: "reviewed",
  blueprintId: "bp-gated-portal",
  blueprintVersion: "1.0.0",
  authoredBy: "specialist-a",
  reviewedBy: "specialist-b",
  authoredAt: new Date("2026-08-30T10:00:00Z"),
  reviewedAt: new Date("2026-08-30T16:00:00Z"),
  mappings: [
    // The credential fields. Markers, and the only mapping a password may have.
    {
      fieldRef: "account_password",
      source: { kind: "secure_credential", purpose: "portal_account_creation" },
      note: "Typed by the Secure Plane's fill agent from the vault. Never from the profile.",
    },
    {
      fieldRef: "account_password_confirm",
      source: { kind: "secure_credential", purpose: "portal_account_creation" },
      note: "The same single handle fills both fields in one use — the student is asked once.",
    },
    {
      fieldRef: "account_email",
      source: { kind: "profile_field", fieldKey: "contact.email", format: { kind: "text" } },
    },
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
        format: { kind: "date", pattern: "DD/MM/YYYY" },
      },
      note: "The portal's pattern attribute is \\d{2}/\\d{2}/\\d{4}; British order confirmed on review.",
    },
    {
      fieldRef: "nationality",
      source: {
        kind: "profile_field",
        fieldKey: "identity.nationality",
        format: {
          kind: "option",
          options: { Iranian: "IR", Iraqi: "IQ", British: "GB" },
        },
      },
    },
    {
      fieldRef: "personal_statement",
      source: {
        kind: "profile_field",
        fieldKey: "study.personal_statement",
        format: { kind: "text" },
      },
    },
  ],
};

// ───────────────────────────────────────────────────────────────────────────
// The same portal, with a third page that takes a document (P74)
// ───────────────────────────────────────────────────────────────────────────

/**
 * The gated portal with a documents page after the course page — the shape a
 * real application has, and the one the attachment path (ADR-0069, ADR-0099)
 * is proved against in the journey.
 *
 * A separate blueprint rather than a page added to `GATED_PORTAL_BLUEPRINT`:
 * every suite that stands on the two-page portal would otherwise need a held
 * document to reach the end of it, which is not what those suites are about.
 * The fixture portal serves `/documents` whether or not a blueprint names it.
 */
export const GATED_PORTAL_WITH_DOCUMENTS_BLUEPRINT: ApplicationBlueprint = {
  ...GATED_PORTAL_BLUEPRINT,
  blueprintId: "bp-gated-portal-documents" as BlueprintId,
  pages: [
    ...GATED_PORTAL_BLUEPRINT.pages.map((page) =>
      page.pageRef === "page-study" ? { ...page, nextPageRef: "page-documents" } : page,
    ),
    {
      pageRef: "page-documents",
      title: "Your documents",
      url: `${GATED_PORTAL_ORIGIN}/documents`,
      sections: [
        {
          sectionRef: "sec-documents",
          title: "Your documents",
          fields: [
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
          ],
        },
      ],
      requiredDocuments: [],
      advanceControl: { strategy: "role", value: "button:Save and continue" },
    },
  ],
  // The submit control stays on the review page the portal reaches after the
  // documents page; the blueprint's submission model is unchanged, and never
  // executed (ADR-0014).
};

/** The reviewed mapping set for it: the gated set, plus the passport onto its box. */
export const GATED_PORTAL_WITH_DOCUMENTS_MAPPING_SET: MappingSet = {
  ...GATED_PORTAL_MAPPING_SET,
  mappingSetId: "map-gated-portal-documents",
  blueprintId: "bp-gated-portal-documents",
  mappings: [
    ...GATED_PORTAL_MAPPING_SET.mappings,
    {
      fieldRef: "passport_upload",
      source: { kind: "document", documentRef: "passport" },
      note: "The passport the student holds in the vault, under the disclosure the preview names.",
    },
  ],
};
