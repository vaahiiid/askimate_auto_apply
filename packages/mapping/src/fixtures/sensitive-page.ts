/**
 * A page that asks what this system cannot hold — the fixture for ADR-0102.
 *
 * Modelled on the first real form (Sheffield's equal-opportunities page,
 * 2026-09-11): a disability checkbox whose own label says the university asks
 * again later, an ethnic-origin select with a "Prefer not to say" entry, and a
 * free-text box about support needs that offers no refusal at all. The empty
 * save was refused on the real page, so leaving the page blank is not a way
 * out; the form's own opt-out is — and the text box has none, which is the
 * case the general rule exists for.
 */

import type { ApplicationBlueprint, BlueprintPage } from "@askimate/aas-blueprint";

import type { FieldMapping } from "../mapping.js";

export const SENSITIVE_PAGE: BlueprintPage = {
  pageRef: "page-equal-opportunities",
  title: "Equal opportunities",
  url: "https://apply.example.test/equal-opportunities",
  sections: [
    {
      sectionRef: "sec-eo",
      title: "Equal opportunities",
      fields: [
        {
          fieldRef: "disability_prefer_not_to_say",
          label:
            "Prefer not to say (if you go on to register on a course you will have another " +
            "opportunity to answer later)",
          inputType: "checkbox",
          dataCategory: "special_category",
          locators: [{ strategy: "name", value: "ratherNotSay" }],
          validations: [],
        },
        {
          fieldRef: "ethnic_origin",
          label: "Please select the term you feel describes your ethnic origin.",
          inputType: "select",
          dataCategory: "special_category",
          locators: [{ strategy: "name", value: "ethnicOriginCode" }],
          validations: [],
          options: [
            { value: "", label: "(blank)" },
            { value: "160", label: "White - English, Scottish, Welsh, Northern Irish or British" },
            { value: "998", label: "Prefer not to say" },
          ],
        },
        {
          fieldRef: "support_needs",
          label: "If you have additional support needs please provide a brief description:",
          inputType: "textarea",
          dataCategory: "special_category",
          locators: [{ strategy: "name", value: "supportNeeds" }],
          validations: [],
        },
      ],
    },
  ],
  requiredDocuments: [],
};

/** The fixture blueprint with the page appended, at a version of its own. */
export function withSensitivePage(blueprint: ApplicationBlueprint): ApplicationBlueprint {
  return {
    ...blueprint,
    version: `${blueprint.version}-eo`,
    pages: [...blueprint.pages, SENSITIVE_PAGE],
  };
}

/**
 * The refusals the form offers, as a reviewer would map them. The text box has
 * no refusal to offer and is deliberately absent: the plan must block on it.
 */
export const SENSITIVE_REFUSAL_MAPPINGS: readonly FieldMapping[] = [
  {
    fieldRef: "disability_prefer_not_to_say",
    source: {
      kind: "form_refusal",
      value: "true",
      rationale:
        "Health is Article 9 data this system cannot hold. The form offers this refusal and " +
        "says the university asks again at registration.",
      formSays: "if you go on to register on a course you will have another opportunity to answer later",
    },
  },
  {
    fieldRef: "ethnic_origin",
    source: {
      kind: "form_refusal",
      value: "998",
      rationale: "Ethnic origin is Article 9 data this system cannot hold. The form offers this refusal.",
    },
  },
];
