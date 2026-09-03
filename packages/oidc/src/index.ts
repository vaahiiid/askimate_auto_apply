/**
 * @askimate/aas-oidc — the standards-only identity adapter (ADR-0038, ADR-0056).
 *
 * ADR-0038's constraint, made structural: *"No vendor-specific claim, SDK-only
 * feature, or proprietary session format appears anywhere outside a single
 * adapter module."* This is that module, and it is a PACKAGE so the boundary is
 * enforced by the dependency graph rather than by everyone remembering.
 *
 * Amazon Cognito is the first provider. Nothing here names it: every endpoint
 * comes from the provider's own discovery document, so where a provider puts
 * its authorize or token endpoint is a fact this repository never encodes.
 */

export type { IdentityClaims, LoginStart, OidcAdapter, OidcAdapterOptions } from "./adapter.js";
export { EMAIL_SCOPE, IDENTITY_OUTCOMES, discoverAdapter, identityFromClaims } from "./adapter.js";
