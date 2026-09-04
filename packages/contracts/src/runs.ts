/**
 * What a client learns about an application run — `POST /v1/conversations/{id}/runs`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * P1's brief: *"If a new wire type is required, it belongs in
 * `packages/contracts`. Do not place client-consumed wire types inside route
 * implementation files."* That instruction has a history in this repository:
 * `ChatSendResponse` lived in an Express route module and the browser imported
 * it from there, which made a client bundle depend on a file that also imports
 * `express`. A wire type belongs where the wire is described.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Position and identity. Nothing a step SAID ────────────────────────────
 *
 * `RunStep` branches carry prompts, previews, fill plans and violation lists.
 * None of that is here, and the omission is the design: this endpoint answers
 * *where is the run*, and a client that needed the student's next question
 * reads the conversation log, which is the one place a student-visible sentence
 * is durable and ordered (ADR-0031).
 *
 * So the payload is four closed-set words, three identifiers and a number.
 * There is no free-text field on it at all — which also means there is no field
 * into which a future change could interpolate a value.
 *
 * ── The words are written twice, on purpose ───────────────────────────────
 *
 * `WorkflowPhase` and `WorkflowStatus` live in `@askimate/aas-domain` and the
 * step kinds live in `@askimate/aas-orchestrator`. This package has NO
 * dependencies — it is consumed by two services and two browser bundles, one of
 * which is the secure control, and a dependency here is a dependency in all
 * four. So the sets are re-declared, and `scripts/contract-drift.test.ts`
 * compares them in both directions. That is the same arrangement, and the same
 * reason, as the secret lifecycle words.
 */

export const RUN_PHASES = [
  "preparing_inputs",
  "interviewing",
  "awaiting_specialist",
  "awaiting_secret",
  "creating_account",
  "awaiting_student_handoff",
  "awaiting_authorisation",
  "filling",
  "ready_to_submit",
  "handing_over",
] as const;
export type RunPhase = (typeof RUN_PHASES)[number];

export const RUN_STATUSES = [
  "running",
  "suspended",
  "uncertain",
  "escalated",
  "completed",
  "abandoned",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The KIND of the orchestrator's decision. Never its contents. */
export const RUN_STEP_KINDS = [
  "interview",
  "specialist",
  "fix_content",
  "authorise",
  "execute",
  "create_account",
  "request_secret",
  "student_handoff",
  "ready_to_submit",
  "hand_over_account",
] as const;
export type RunStepKind = (typeof RUN_STEP_KINDS)[number];

/**
 * Why a run could not be started, as a closed set.
 *
 * `unusable_mapping_set` carries no detail on the wire even though the driver
 * has one: a mapping set's refusal names fields of a university's form, and a
 * student can do nothing with it. It is a specialist's problem, and the
 * specialist reads the service's own diagnostics.
 */
export const RUN_REFUSALS = [
  "unknown_blueprint",
  "unusable_mapping_set",
  "case_not_bindable",
] as const;
export type RunRefusalCode = (typeof RUN_REFUSALS)[number];

export interface ConversationRun {
  readonly runId: string;
  readonly caseId: string;
  readonly conversationId: string;
  readonly status: RunStatus;
  readonly phase: RunPhase;
  readonly step: RunStepKind;
  /** Optimistic-concurrency revision of the durable checkpoint. */
  readonly revision: number;
  /** True when the call resumed an existing run rather than creating one. */
  readonly resumed: boolean;
}

/**
 * COMPILE-TIME: no field of a run's wire form may be free text.
 *
 * The type-level form of the paragraph above. A `say`, a `detail` or a
 * `preview` added later makes this stop being `never` and fails the build
 * naming the field. It is a CONSTRAINT rather than a computation, because an
 * assertion that merely evaluates to `never` on failure is vacuous.
 */
type UnclosedStrings<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends RunStatus | RunPhase | RunStepKind | number | boolean
    ? never
    : NonNullable<T[K]> extends string
      ? K extends "runId" | "caseId" | "conversationId"
        ? never
        : K
      : K;
}[keyof T];
type AssertNever<T extends never> = T;
export type NO_RUN_FIELD_IS_FREE_TEXT = AssertNever<UnclosedStrings<ConversationRun>>;

function isMember<T extends string>(members: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (members as readonly string[]).includes(value);
}

/** Bytes from the network to a run, or `null`. */
export function parseConversationRun(value: unknown): ConversationRun | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of ["runId", "caseId", "conversationId"]) {
    const held = record[field];
    if (typeof held !== "string" || held.length === 0) return null;
  }
  if (!isMember(RUN_STATUSES, record["status"])) return null;
  if (!isMember(RUN_PHASES, record["phase"])) return null;
  if (!isMember(RUN_STEP_KINDS, record["step"])) return null;
  if (typeof record["revision"] !== "number" || !Number.isInteger(record["revision"])) return null;
  if (typeof record["resumed"] !== "boolean") return null;
  return {
    runId: record["runId"] as string,
    caseId: record["caseId"] as string,
    conversationId: record["conversationId"] as string,
    status: record["status"],
    phase: record["phase"],
    step: record["step"],
    revision: record["revision"],
    resumed: record["resumed"],
  };
}


/**
 * What the student is asked to authorise. ADR-0059.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SEPARATE resource from `ConversationRun`, and the constraint above is why.
 * `NO_RUN_FIELD_IS_FREE_TEXT` says in as many words that *"a `say`, a `detail`
 * or a `preview` added later makes this stop being `never` and fails the build
 * naming the field"*. That was written before anything needed a preview, and it
 * was right: position and free text are different kinds of fact, and a run's
 * wire form is polled, cached and logged in ways this must not be.
 *
 * So the preview is its own read, with its own posture — `no-store`, never
 * persisted, never logged — rather than a field smuggled onto a shape that
 * deliberately has no room for one.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface RunPreview {
  /** `sha256:<hex>` over the canonical content. What an authorisation names. */
  readonly contentHash: string;
  readonly hashAlgorithm: "sha256";
  /**
   * The complete application, as the student reads it.
   *
   * Deterministic and model-free. Carries values that will be SENT and never a
   * credential: a credential field appears in the application as a field the
   * Secure Plane will fill, and `renderPreview` does not render the credential
   * list at all (ADR-0043).
   */
  readonly presentedText: string;
}

/** Bytes from the network to a preview, or `null`. */
export function parseRunPreview(value: unknown): RunPreview | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const contentHash = record["contentHash"];
  const presentedText = record["presentedText"];
  if (typeof contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(contentHash)) return null;
  if (record["hashAlgorithm"] !== "sha256") return null;
  // Length, not emptiness: a preview with no text is a rendering bug, and
  // accepting it would put an empty page in front of a student to approve.
  if (typeof presentedText !== "string" || presentedText.length === 0) return null;
  return { contentHash, hashAlgorithm: "sha256", presentedText };
}
