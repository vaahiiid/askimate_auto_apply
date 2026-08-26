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

export type { ClickDecision, PreparationNetworkPolicy } from "./preparation-safety.js";
export {
  ClickAllowList,
  WriteLog,
  decidePreparationRequest,
  isStateChanging,
  looksLikeSubmission,
} from "./preparation-safety.js";

export type { PreparationMode } from "./playwright-fill-session.js";
export {
  ClickRefusedError,
  LocatorNotFoundError,
  OptionNotAvailableError,
  PlaywrightPreparationSession,
  ValueNotAcceptedError,
  toPlaywrightLocator,
} from "./playwright-fill-session.js";
export {
  draftBlueprintFrom,
  inputTypeOf,
  locatorsOf,
  pageFrom,
  sectionFrom,
  validationsOf,
} from "./discovery.js";
export { OBSERVE_SCRIPT } from "./observe-script.js";

export type { CaptureIndex, CapturedPage, ReplayServer } from "./replay.js";
export { startReplayServer } from "./replay.js";

export type { DiscoveryTarget } from "./target.js";
export { InvalidTargetError, parseTarget, shouldFollow } from "./target.js";
