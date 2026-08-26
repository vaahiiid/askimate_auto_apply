/**
 * @askimate/aas-browser-runner — the isolated browser runtime.
 *
 * Discovery mode is structurally incapable of submitting: a `ReadOnlySession`
 * exposes no fill, click or submit, AND the network guard aborts any request
 * that is not a safe, idempotent read on an allow-listed host (ADR-0014).
 */

export type {
  AuthorisationToken,
  FillableSession,
  ObservedField,
  ObservedForm,
  PageObservation,
  ReadOnlySession,
  SessionMode,
  SubmissionOutcome,
  SubmittableSession,
} from "./session.js";

export type { GuardDecision } from "./safety.js";
export {
  BlockedRequestLog,
  HostAllowList,
  decideDiscoveryRequest,
  decideDiscoveryRequestForHost,
} from "./safety.js";

export { PlaywrightDiscoverySession } from "./playwright-session.js";
export {
  draftBlueprintFrom,
  inputTypeOf,
  locatorsOf,
  pageFrom,
  sectionFrom,
  validationsOf,
} from "./discovery.js";
export { OBSERVE_SCRIPT } from "./observe-script.js";
