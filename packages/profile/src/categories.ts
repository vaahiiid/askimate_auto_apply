/**
 * What KIND of personal data each profile field is.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REGISTRY IS THE BOUNDARY OF WHAT THIS SYSTEM CAN EXTRACT.
 *
 * A document reading enters the system only through an extraction plan target,
 * and every target names a `ProfileFieldKey`. So the set of things extraction
 * can ever produce is exactly this registry — extraction cannot produce a
 * religion because there is nowhere for a religion to go.
 *
 * That property is worth nothing if somebody can add a field. This file is
 * what makes adding one a decision rather than an edit: `FIELD_CATEGORY` is
 * total over `ProfileFieldKey`, so a new field DOES NOT COMPILE until it has
 * been classified, and an extraction plan may only name a field classified
 * `ordinary`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Where this came from ──────────────────────────────────────────────────
 *
 * Decision sheet B1 row 2, on national identity documents: *"30 days, delete —
 * and a determination that we do NOT extract or index any special-category
 * field from it."*
 *
 * Vahid, 2026-09-07: *"Never extracting special-category fields from a national
 * identity document becomes an enforced property of packages/extraction, not a
 * written rule. Make it structurally impossible rather than checked, in the
 * same way field values cannot originate from the model."*
 *
 * The mechanism is deliberately the same shape as the one he names. A value
 * cannot originate from the model because a reading is only accepted against a
 * plan target and its quoted span is checked against the document
 * (`grounding.ts`). A special-category value cannot be extracted because there
 * is no field for it to land in, and no field can appear without a
 * classification.
 *
 * ── What this file is NOT ─────────────────────────────────────────────────
 *
 * It is not legal advice and it does not make a legal determination. Article
 * 9(1)'s categories are quoted below as the statute enumerates them; applying
 * that enumeration to a NEW field is a determination for whoever owns the DPIA,
 * and `undetermined` exists so that the honest answer can be recorded and still
 * block. ADR-0023's rule holds here as everywhere: an unresolved question
 * blocks rather than defaulting.
 */

import type { ProfileFieldKey } from "./fields.js";
import { PROFILE_FIELD_KEYS } from "./fields.js";

/**
 * The categories UK GDPR Article 9(1) enumerates, as it enumerates them.
 *
 * Quoted rather than paraphrased, and present as data rather than prose, so
 * that a reviewer can see what the classification below was made against. This
 * is the statute's list; it is not a reading of it.
 */
export const ARTICLE_9_CATEGORIES = [
  "racial or ethnic origin",
  "political opinions",
  "religious or philosophical beliefs",
  "trade union membership",
  "genetic data",
  "biometric data for the purpose of uniquely identifying a natural person",
  "data concerning health",
  "data concerning a natural person's sex life or sexual orientation",
] as const;

/**
 * What a field is, for the purpose of deciding whether it may be extracted.
 *
 *   ordinary        not within Article 9(1). May be named by an extraction plan.
 *   special_category  within Article 9(1). May never be named by a plan.
 *   undetermined    nobody competent has decided. Blocks, exactly as an
 *                   unresolved retention requirement blocks (ADR-0023) — the
 *                   dangerous state is the one that looks decided.
 */
export type DataCategory = "ordinary" | "special_category" | "undetermined";

/**
 * Every field, classified.
 *
 * ── Why `satisfies` and not a plain annotation ────────────────────────────
 *
 * `satisfies Record<ProfileFieldKey, DataCategory>` makes the record TOTAL: a
 * field added to `ProfileFieldTypes` without a line here fails to compile, at
 * the registry, before anything can name it. Keeping the literal types (rather
 * than widening to `DataCategory`) is what lets `OrdinaryFieldKey` below be
 * derived rather than maintained as a second list that could disagree.
 *
 * ── The readings, and their limits ────────────────────────────────────────
 *
 * Every field here is `ordinary`, and that is a reading against the
 * enumeration above rather than a certificate. Two are worth naming because a
 * reviewer will ask:
 *
 *   identity.nationality — nationality is not one of Article 9(1)'s categories,
 *     and "racial or ethnic origin" is not a synonym for it. It is nonetheless
 *     capable of acting as a proxy for ethnic origin, which is a DPIA question
 *     about PURPOSE and inference rather than about this field's category.
 *     Extracted from passports today, and classified on that basis.
 *
 *   identity.sex — sex is not within Article 9(1). Sexual orientation and sex
 *     life are; gender reassignment data can be health data. Nothing in this
 *     registry carries either, and a field that did would be
 *     `special_category` here.
 *
 * Financial fields are `ordinary` too. They escalate to a person every time
 * (`isFinancialField`), which is a different control for a different reason —
 * high consequence, not Article 9.
 */
export const FIELD_CATEGORY = {
  "identity.given_name": "ordinary",
  "identity.family_name": "ordinary",
  "identity.date_of_birth": "ordinary",
  "identity.nationality": "ordinary",
  "identity.country_of_birth": "ordinary",
  "identity.sex": "ordinary",
  "identity.passport_number": "ordinary",
  "identity.passport_expiry": "ordinary",
  "identity.passport_issuing_country": "ordinary",
  "contact.email": "ordinary",
  "contact.mobile": "ordinary",
  "contact.address": "ordinary",
  "education.highest_qualification": "ordinary",
  "education.prior_qualifications": "ordinary",
  "education.english_language_test": "ordinary",
  "study.personal_statement": "ordinary",
  "study.intended_start": "ordinary",
  "finance.available_funds": "ordinary",
  "finance.funding_source": "ordinary",
  "finance.sponsor_name": "ordinary",
  "immigration.previous_uk_visas": "ordinary",
  "immigration.previous_visa_refusals": "ordinary",
  "guardian.given_name": "ordinary",
  "guardian.family_name": "ordinary",
  "guardian.relationship": "ordinary",
  "guardian.email": "ordinary",
  "guardian.mobile": "ordinary",
} as const satisfies Record<ProfileFieldKey, DataCategory>;

/**
 * The fields an extraction plan may name.
 *
 * DERIVED from the classification, so the two cannot disagree. Naming anything
 * else in a plan is a compile error at the line where the plan is written,
 * which is where a reader would look for the mistake — the same argument
 * `scalar()`'s parse checking already makes.
 */
export type OrdinaryFieldKey = {
  [K in ProfileFieldKey]: (typeof FIELD_CATEGORY)[K] extends "ordinary" ? K : never;
}[ProfileFieldKey];

export function categoryOf(key: ProfileFieldKey): DataCategory {
  return FIELD_CATEGORY[key];
}

/** True when a field may be read off a document at all. */
export function isExtractable(key: ProfileFieldKey): boolean {
  return categoryOf(key) === "ordinary";
}

/**
 * Every field that may NOT be extracted, with what is wrong with it.
 *
 * A runtime companion to the type above, because the type erases and a plan
 * assembled from data rather than written as a literal would slip past it.
 * `plans.test.ts` runs this over the REAL plans, and over a fabricated one, so
 * the answer "nothing is wrong" is known to be an answer rather than a
 * vacuum.
 */
export function unextractableFields(
  keys: readonly ProfileFieldKey[],
  /**
   * How to classify. Defaults to the real classification.
   *
   * A parameter and not a constant, so a test can drive THIS function with a
   * classification it must reject rather than re-implementing the filter
   * beside it and proving nothing. Every field in the registry is `ordinary`
   * today, so without this the assertion "nothing is unextractable" would pass
   * just as happily against a function that always returned an empty list.
   */
  classify: (key: ProfileFieldKey) => DataCategory = categoryOf,
): readonly { readonly key: ProfileFieldKey; readonly category: DataCategory }[] {
  return keys
    .map((key) => ({ key, category: classify(key) }))
    .filter((row) => row.category !== "ordinary");
}

/** Every classified field, for iteration. Total by construction. */
export const CLASSIFIED_FIELD_KEYS: readonly ProfileFieldKey[] = PROFILE_FIELD_KEYS;
