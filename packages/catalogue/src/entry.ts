/**
 * What a specialist reviews, and what a deployment supplies.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0057 §"What the hash deliberately does not cover". A `CatalogueEntry` as
 * the run driver needs it mixes two different kinds of fact, and only one of
 * them is reviewed:
 *
 *   REVIEWED     both artefacts, the institution/course/intake identity, the
 *                required documents, the observed portal authentication, and
 *                the password-delivery decision
 *
 *   DEPLOYMENT   `portalOrigin` — WHICH deployment of that portal to run
 *                against
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The split is not new. `CatalogueEntry.portalOrigin` already existed for
 * exactly this reason: the same reviewed blueprint is run against a
 * university's UAT environment before it is ever run against production, and
 * rewriting the blueprint to point at the sandbox would mean running a
 * blueprint nobody reviewed.
 *
 * P20 makes the consequence structural. `ReviewedCatalogueEntry` is the thing
 * that gets hashed and approved; the origin is applied afterwards, at load
 * time, from configuration. So moving a reviewed entry between environments
 * does not change its hash — and cannot, because the origin is not in it.
 */

import type { ObservedPortalAuthentication, PasswordDelivery } from "@askimate/aas-account";
import type { ApplicationBlueprint } from "@askimate/aas-blueprint";
import type { MappingSet } from "@askimate/aas-mapping";

import type { Canonical } from "./canonical.js";
import { canonicalDate } from "./canonical.js";

/**
 * Everything about a catalogue entry that a human reviews.
 *
 * Field for field this is `CatalogueEntry` minus `portalOrigin`. It is written
 * out rather than derived with `Omit<>` so that adding a field to one and not
 * the other is a compile error somebody has to look at — `entryFrom` below is
 * where that error appears.
 */
export interface ReviewedCatalogueEntry {
  readonly blueprint: ApplicationBlueprint;
  readonly mappingSet: MappingSet;
  readonly requiredDocuments: readonly string[];
  readonly institutionRef: string;
  readonly courseRef: string;
  /** `YYYY-MM`. The submission identity, never a prose label. */
  readonly intakeRef: string;
  readonly portalAuthentication?: ObservedPortalAuthentication;
  readonly passwordDelivery?: PasswordDelivery;
}

/**
 * The canonical value of an artefact: dates as ISO-8601, absent keys omitted.
 *
 * Generic rather than a field-by-field mirror of `ReviewedCatalogueEntry`, and
 * that is deliberate. A hand-written canonicaliser is a second list of every
 * field, and the failure mode when the two lists drift is the worst one
 * available: a field that is parsed, acted upon, and NOT hashed — so altering
 * it would not move the hash and an approval would still cover it.
 *
 * Walking the parsed object cannot drift, because the parser is the only thing
 * that puts fields there.
 */
export function toCanonical(value: unknown): Canonical {
  if (value === null) return null;
  if (value instanceof Date) return canonicalDate(value);
  if (Array.isArray(value)) return value.map(toCanonical);

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value as string | boolean;
  if (kind === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("a non-finite number cannot appear in a canonical artefact");
    }
    return value as number;
  }
  if (kind === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, Canonical> = {};
    for (const key of Object.keys(source).sort()) {
      const item = source[key];
      // Absent stays absent. `canonicalText` omits it too; doing it here as
      // well keeps the intermediate value honest for anything that reads it.
      if (item === undefined) continue;
      out[key] = toCanonical(item);
    }
    return out;
  }

  // A function, a symbol or a bigint in an artefact means something built it
  // that was not the parser. Refused rather than skipped: silently dropping it
  // would hash an artefact that is not the one in hand.
  throw new Error(`a ${kind} cannot appear in a canonical artefact`);
}
