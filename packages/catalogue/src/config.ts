/**
 * Which catalogue a process serves, read once and identically by every process
 * that serves one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Written once and shared, not copied into each entry point. ADR-0041: the
 * Conversation Service and the Worker must not hold two opinions about which
 * artefacts exist. Two copies of this logic would let one of them accept
 * `fixtures` in production while the other refused — and the divergence would
 * show up as a worker advancing a run the service would never have started.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Reader } from "@askimate/aas-config";

export type CatalogueSource = "fixtures" | "registry";

export interface CatalogueConfig {
  readonly catalogue: CatalogueSource;
  /** Where reviewed entries and their approvals live. Required by `registry`. */
  readonly catalogueDir?: string;
  /** `blueprintId` → deployment origin. NOT reviewed data, and never hashed. */
  readonly portalOrigins: Readonly<Record<string, string>>;
}

/**
 * `bp-one=https://uat.example.ac.uk,bp-two=https://other.test` → a lookup.
 *
 * A deployment fact, and the reason it is configuration rather than a field in
 * the artefact: the same reviewed blueprint is run against a university's UAT
 * environment before it is ever run against production, and editing the
 * blueprint to point at the sandbox would mean running something nobody
 * reviewed — and, since ADR-0057, something whose hash no longer matches its
 * approval.
 */
function parseOrigins(r: Reader, key: string): Readonly<Record<string, string>> {
  const raw = r.optionalString(key);
  if (raw === undefined) return {};
  const origins: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (trimmed.length === 0) continue;
    const at = trimmed.indexOf("=");
    const id = at === -1 ? "" : trimmed.slice(0, at).trim();
    const origin = at === -1 ? "" : trimmed.slice(at + 1).trim();
    if (id.length === 0 || origin.length === 0) {
      r.refuse(key, "expects comma-separated blueprintId=origin pairs");
      continue;
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      r.refuse(key, `has an origin that is not a URL: ${origin}`);
      continue;
    }
    if (r.production && parsed.protocol !== "https:") {
      r.refuse(key, `names a non-https origin, which production does not accept: ${origin}`);
      continue;
    }
    origins[id] = parsed.origin;
  }
  return origins;
}

/**
 * Reads the three catalogue variables.
 *
 * `fixtures` stays refused in production and P20 does not soften that: the
 * gated portal is a TEST artefact, and promoting it would be exactly the
 * dishonesty this phase was scoped to avoid. What P20 adds is a second value
 * production CAN accept, because what it serves has been through an approval
 * registry rather than through a compiler.
 */
export function readCatalogueConfig(r: Reader): CatalogueConfig {
  const catalogue = r.choice("AAS_CATALOGUE", ["fixtures", "registry"] as const);

  if (r.production && catalogue === "fixtures") {
    r.refuse(
      "AAS_CATALOGUE",
      "is 'fixtures', which serves the gated TEST portal. Production serves reviewed entries " +
        "only: set it to 'registry' and point AAS_CATALOGUE_DIR at a catalogue whose approvals " +
        "cover the entries in it (ADR-0057).",
    );
  }

  const catalogueDir = r.optionalString("AAS_CATALOGUE_DIR");
  if (catalogue === "registry" && catalogueDir === undefined) {
    r.refuse(
      "AAS_CATALOGUE_DIR",
      "is required when AAS_CATALOGUE is 'registry'. There is nowhere else a reviewed entry " +
        "could come from, and defaulting to a directory would be guessing which artefacts a " +
        "deployment means to serve.",
    );
  }

  return {
    catalogue,
    ...(catalogueDir === undefined ? {} : { catalogueDir }),
    portalOrigins: parseOrigins(r, "AAS_PORTAL_ORIGINS"),
  };
}
