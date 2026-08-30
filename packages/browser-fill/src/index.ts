/**
 * @askimate/aas-browser-fill — the parts of filling a form field that two
 * different trust boundaries both need.
 *
 * The runner resolves locators for ordinary fields. The Secure Plane's fill
 * agent (ADR-0042) resolves the same locators for the one field a password goes
 * into, and additionally verifies the page before typing. Sharing the
 * resolution is the point: two copies would eventually disagree about which
 * element a blueprint meant, and on the agent's side that disagreement is a
 * password typed somewhere it should not be.
 *
 * This package holds NO secret state and has no way to obtain a secret. It is
 * given one, by a caller that took it from the vault.
 */

export { FIELD_TIMEOUT_MS, toPlaywrightLocator } from "./locator.js";
export { fieldIsMasked, pageHostMatches, snapshotStreamerPresent } from "./guards.js";
export { SecretNotAcceptedError, typeSecretInto } from "./type-secret.js";
