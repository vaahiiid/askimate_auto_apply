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
export type { FlowSignal, RawObservation } from "./observe-script.js";
export { OBSERVE_SCRIPT } from "./observe-script.js";

export type { CaptureIndex, CapturedPage, ReplayServer } from "./replay.js";
export { startReplayServer } from "./replay.js";

// A controlled portal that actually requires an account. Test infrastructure,
// exported like `startReplayServer` beside it, because the suites that need it
// live in other packages.
export type { FixturePortal, PortalApplication } from "./fixture-portal.js";
export { startFixturePortal } from "./fixture-portal.js";

export type { SensitiveContextOptions } from "./sensitive.js";
export { TracingForbiddenError, openSensitiveContext, tracingIsForbidden } from "./sensitive.js";

export type { SecretFillClaim, SecretFillOutcome } from "./secret-fill.js";
export { SecretIntoTracedContextError, fillSecret } from "./secret-fill.js";
// `SecretNotAcceptedError` and `untracedPageConsumer` are gone from this app.
// ADR-0042: the first moved to @askimate/aas-browser-fill with the keystroke
// that raises it, and the second described a capability this process no longer
// has — there is nothing here for a secret to be consumed BY.
export { SecretNotAcceptedError } from "@askimate/aas-browser-fill";

export type { DiscoveryTarget } from "./target.js";
export { InvalidTargetError, parseTarget, shouldFollow } from "./target.js";

// ── ADR-0045: work intake. The runner PULLS; nothing calls into it ─────────
export type {
  PerformOutcome,
  TurnResult,
  WorkIntake,
  WorkIntakeOptions,
  WorkPerformer,
} from "./work-intake.js";
export { httpWorkIntake, runOneTurn } from "./work-intake.js";

// ── P6: the first consequential action, on somebody else's website ────────
export type { CreateAccountDeps } from "./create-account.js";
export { createPortalAccount } from "./create-account.js";

// ── P8 / ADR-0046: the plan, reassembled and executed ─────────────────────
export type { FillApplicationDeps } from "./fill-application.js";
export { fillApplication } from "./fill-application.js";
