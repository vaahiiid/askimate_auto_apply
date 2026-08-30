/**
 * @askimate/aas-secure-filler — the Secure Plane's fill agent (ADR-0042).
 *
 * The component that consumes a credential, running inside the Secure Plane's
 * trust boundary rather than the automation runner's. The runner asks it to
 * fill a field and learns whether the field was filled; it never holds the
 * value, never holds a vault, and has no credential that could decrypt one.
 */

export type { AuthoriseOptions, UseAuthorisation } from "./authorise.js";
export { httpUseAuthoriser } from "./authorise.js";
export type { ConnectToBrowser, FillAgentDeps } from "./fill.js";
export { performSecretFill } from "./fill.js";
export type { FillAgentAppOptions } from "./app.js";
export { createFillAgentApp } from "./app.js";
