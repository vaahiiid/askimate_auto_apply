/**
 * @askimate/aas-catalogue — loading a reviewed artefact, and proving it is one.
 *
 * ADR-0057: an approval binds to content, not to what the content says about
 * itself. Nothing in this package trusts an artefact's own `status`,
 * `reviewedBy` or `reviewedAt` to decide whether production may run it.
 */

export type { CatalogueConfig, CatalogueSource } from "./config.js";
export { readCatalogueConfig } from "./config.js";

export type { Canonical } from "./canonical.js";
export {
  HASH_PREFIX,
  canonicalDate,
  canonicalText,
  contentHash,
  isLabelledHash,
  labelledHash,
} from "./canonical.js";

export type { ReviewedCatalogueEntry } from "./entry.js";
export { toCanonical } from "./entry.js";

export type { ParseRefusal, ParseResult } from "./parse.js";
export { parseBlueprint, parseMappingSet, parseReviewedEntry, parseReviewedEntryText } from "./parse.js";

export type { Approval, ApprovalRefusal, ApprovalRegistry, ApprovalResult } from "./registry.js";
export { InMemoryApprovalRegistry, approveContent, hashOf } from "./registry.js";

export type { DeployedCatalogueEntry, LoadRefusal, LoadResult } from "./loader.js";
export { ReviewedCatalogue, loadReviewedEntry } from "./loader.js";

export type { CatalogueLoad, CatalogueProblem } from "./files.js";
export {
  APPROVALS_FILE,
  ENTRIES_DIR,
  loadCatalogueDirectory,
  parseApprovals,
  readRegistry,
} from "./files.js";
