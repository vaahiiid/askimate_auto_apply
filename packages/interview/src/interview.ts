/**
 * The interview capability.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A CAPABILITY OF THE EXISTING ASKIMATE CHAT — NOT A NEW INTERFACE (ADR-0015).
 *
 * Nothing here renders anything. It returns *what to say next*, and AskiMate
 * Chat presents it in the conversation the student is already having.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The loop, from Vahid's description:
 *
 *   identify what the application needs
 *     → ask ONE question, in the chat
 *     → student answers, in the chat
 *     → evaluate whether the answer is sufficient
 *     → if missing or ambiguous, ask the next question
 *     → if a document is needed, ask for it conversationally
 *     → once collected AND CONFIRMED, it enters the profile
 *
 * Two rules run through all of it:
 *
 *   ONE THING AT A TIME. The agent asks a single question and waits. It does
 *   not present a list, because a list of questions is a form.
 *
 *   NOTHING ENTERS THE PROFILE UNCONFIRMED. The student's answer becomes a
 *   `ProposedValue`, which is played back and must be agreed. The playback is
 *   rendered DETERMINISTICALLY from the structured value, never paraphrased by
 *   a model — otherwise the student agrees to one thing and another is stored.
 */

import type { ModelText, ProposedValue } from "@askimate/aas-domain";
import type { ModelClient, NotUnderstood } from "@askimate/aas-llm";
import { isNotUnderstood } from "@askimate/aas-llm";
import type {
  ConfirmedField,
  ConfirmedProfile,
  ProfileFieldKey,
  ProfileFieldType,
} from "@askimate/aas-profile";
import {
  FIELD_LABELS,
  applyConfirmation,
  confirmField,
  isDeclined,
  missingFields,
  renderForConfirmation,
} from "@askimate/aas-profile";

import type { FieldSpec } from "./field-specs.js";
import { FIELD_SPECS } from "./field-specs.js";

/**
 * What AskiMate Chat should do next.
 *
 * A closed union: every possible next move is one of these, so the chat layer
 * has a complete and checkable contract rather than free-form instructions.
 */
export type InterviewAction =
  /** Say this to the student, and send their reply back. */
  | { readonly kind: "ask"; readonly say: ModelText; readonly fieldKey: ProfileFieldKey }
  /** Ask the student to upload a document, in the conversation. */
  | {
      readonly kind: "request_document";
      readonly say: ModelText;
      readonly documentType: string;
      readonly reason: string;
    }
  /**
   * Show the student what was understood and ask them to confirm.
   *
   * `say` is rendered deterministically from the structured value, NOT written
   * by a model. The student must be agreeing to exactly what will be stored.
   */
  | {
      readonly kind: "confirm";
      readonly say: string;
      readonly fieldKey: ProfileFieldKey;
    }
  /** Everything needed has been collected and confirmed. */
  | { readonly kind: "complete" }
  /**
   * The agent asked and cannot obtain what is required.
   *
   * NOT a licence to guess (ADR-0007). It becomes an `information_unobtainable`
   * escalation and a specialist looks at it.
   */
  | { readonly kind: "escalate"; readonly reason: string; readonly fieldKey?: ProfileFieldKey };

/** A reading awaiting the student's yes or no. */
interface PendingConfirmation {
  readonly fieldKey: ProfileFieldKey;
  readonly proposed: ProposedValue<unknown>;
}

/** The interview's state. Immutable; every step returns a new one. */
export interface InterviewState {
  readonly studentRef: string;
  readonly profile: ConfirmedProfile;
  /** What this application needs. Derived from requirements and the blueprint. */
  readonly requiredFields: readonly ProfileFieldKey[];
  /** Documents the application needs, by type. */
  readonly requiredDocuments: readonly string[];
  /** Documents already collected and confirmed. */
  readonly collectedDocuments: readonly string[];
  readonly pending?: PendingConfirmation;
  /** How many times each field has been asked. Drives rephrasing and escalation. */
  readonly attempts: ReadonlyMap<ProfileFieldKey, number>;
  /** Recent turns, so questions fit the conversation. */
  readonly transcript: readonly string[];
}

/**
 * How many times to ask before escalating.
 *
 * Three is a judgement, not a law: enough to rephrase and try again, few enough
 * that the student is not interrogated. When it is reached the answer is to
 * escalate — never to proceed without the information.
 */
export const MAX_ATTEMPTS_PER_FIELD = 3;

export function newInterview(input: {
  readonly studentRef: string;
  readonly profile: ConfirmedProfile;
  readonly requiredFields: readonly ProfileFieldKey[];
  readonly requiredDocuments: readonly string[];
}): InterviewState {
  return {
    studentRef: input.studentRef,
    profile: input.profile,
    requiredFields: input.requiredFields,
    requiredDocuments: input.requiredDocuments,
    collectedDocuments: [],
    attempts: new Map(),
    transcript: [],
  };
}

/**
 * Clears the pending confirmation.
 *
 * Under `exactOptionalPropertyTypes`, "absent" and "present but undefined" are
 * different things, and absent is what we mean — so the key is destructured
 * away rather than assigned `undefined`.
 */
function withoutPending(state: InterviewState): InterviewState {
  const { pending: _cleared, ...rest } = state;
  return rest;
}

function specFor(key: ProfileFieldKey): FieldSpec<unknown> | undefined {
  return FIELD_SPECS[key];
}

/**
 * Decides what to say next.
 *
 * Called by AskiMate Chat when a case needs information, and again after every
 * student reply.
 */
export async function nextAction(
  state: InterviewState,
  model: ModelClient,
): Promise<InterviewAction> {
  // A pending confirmation always takes priority. Asking a new question while
  // one is outstanding would leave the student unsure what they are answering.
  if (state.pending !== undefined) {
    const label = FIELD_LABELS[state.pending.fieldKey];
    return {
      kind: "confirm",
      fieldKey: state.pending.fieldKey,
      // Deterministic rendering, from the profile package. Not model-written.
      say: renderForConfirmation(
        state.pending.fieldKey,
        state.pending.proposed as ProposedValue<ProfileFieldType<ProfileFieldKey>>,
        label,
      ),
    };
  }

  const outstanding = missingFields(state.profile, state.requiredFields);

  // Fields before documents: an upload request lands better once the agent
  // knows who it is talking to.
  const nextField = outstanding.find(
    (key) => (state.attempts.get(key) ?? 0) < MAX_ATTEMPTS_PER_FIELD,
  );

  if (nextField !== undefined) {
    const spec = specFor(nextField);
    if (spec === undefined) {
      return {
        kind: "escalate",
        fieldKey: nextField,
        reason:
          `No question is defined for "${nextField}". The agent will not improvise one for a ` +
          `field it does not understand.`,
      };
    }

    const say = await model.composeQuestion({
      fieldKey: nextField,
      label: FIELD_LABELS[nextField],
      rationale: spec.rationale,
      conversationContext: state.transcript.slice(-6),
      previousAttempts: state.attempts.get(nextField) ?? 0,
    });

    return { kind: "ask", say, fieldKey: nextField };
  }

  // A field that ran out of attempts blocks the case.
  const exhausted = outstanding.find(
    (key) => (state.attempts.get(key) ?? 0) >= MAX_ATTEMPTS_PER_FIELD,
  );
  if (exhausted !== undefined) {
    return {
      kind: "escalate",
      fieldKey: exhausted,
      reason:
        `Asked for "${FIELD_LABELS[exhausted]}" ${String(MAX_ATTEMPTS_PER_FIELD)} times without ` +
        `obtaining a usable answer. A specialist should look at this rather than the application ` +
        `proceeding without it.`,
    };
  }

  const missingDocument = state.requiredDocuments.find(
    (type) => !state.collectedDocuments.includes(type),
  );
  if (missingDocument !== undefined) {
    const label = missingDocument.replace(/_/g, " ");
    const say = await model.composeDocumentRequest({
      documentType: missingDocument,
      label,
      rationale: `The university asks for your ${label} with the application.`,
      conversationContext: state.transcript.slice(-6),
    });
    return {
      kind: "request_document",
      say,
      documentType: missingDocument,
      reason: `Required by the application.`,
    };
  }

  return { kind: "complete" };
}

/** What happened to a student's reply. */
export type ReplyOutcome =
  | { readonly kind: "understood"; readonly state: InterviewState }
  | { readonly kind: "not_understood"; readonly state: InterviewState; readonly reason: string }
  | { readonly kind: "confirmed"; readonly state: InterviewState }
  | { readonly kind: "corrected"; readonly state: InterviewState }
  | { readonly kind: "declined"; readonly state: InterviewState; readonly reason: string };

/**
 * Receives what the student said, in answer to a question.
 *
 * The model interprets it into a `ProposedValue`. That value does NOT enter the
 * profile — it becomes the pending confirmation, and the next action plays it
 * back.
 */
export async function receiveAnswer(
  state: InterviewState,
  fieldKey: ProfileFieldKey,
  utterance: string,
  model: ModelClient,
): Promise<ReplyOutcome> {
  const spec = specFor(fieldKey);
  if (spec === undefined) {
    return {
      kind: "not_understood",
      state,
      reason: `No field specification for "${fieldKey}".`,
    };
  }

  const transcript = [...state.transcript, `student: ${utterance}`];
  const attempts = new Map(state.attempts);
  attempts.set(fieldKey, (attempts.get(fieldKey) ?? 0) + 1);

  const interpreted: ProposedValue<unknown> | NotUnderstood = await model.interpretAnswer({
    fieldKey,
    label: FIELD_LABELS[fieldKey],
    utterance,
    expectedShape: spec.expectedShape,
    parse: spec.parse,
  });

  if (isNotUnderstood(interpreted)) {
    // The attempt still counts. Otherwise a student who keeps answering
    // unusably would be asked forever, and the escalation would never fire.
    return {
      kind: "not_understood",
      state: { ...state, transcript, attempts },
      reason: interpreted.reason,
    };
  }

  return {
    kind: "understood",
    state: { ...state, transcript, attempts, pending: { fieldKey, proposed: interpreted } },
  };
}

/**
 * Receives the student's response to a confirmation playback.
 *
 * **This is where a value finally enters the profile** — through
 * `applyConfirmation`, the one function in the system that mints a
 * `ConfirmedValue`.
 */
export function receiveConfirmation(
  state: InterviewState,
  response: { readonly agreed: true } | { readonly agreed: false; readonly correction?: string } ,
  now: Date,
): ReplyOutcome {
  const pending = state.pending;
  if (pending === undefined) {
    return { kind: "not_understood", state, reason: "There is nothing awaiting confirmation." };
  }

  const spec = specFor(pending.fieldKey);
  if (spec === undefined) {
    return { kind: "not_understood", state, reason: `No field specification for "${pending.fieldKey}".` };
  }

  const label = FIELD_LABELS[pending.fieldKey];
  const presentedText = renderForConfirmation(
    pending.fieldKey,
    pending.proposed as ProposedValue<ProfileFieldType<ProfileFieldKey>>,
    label,
  );

  // A correction the agent cannot parse is not a confirmation. Storing the
  // original because the correction was unreadable would be the worst outcome
  // available — the student would have said "no" and been overruled.
  let corrected: unknown = null;
  if (!response.agreed && response.correction !== undefined) {
    corrected = spec.parse(response.correction);
    if (corrected === null) {
      return {
        kind: "not_understood",
        state: withoutPending(state),
        reason: `Could not read a ${spec.expectedShape} from the correction "${response.correction}".`,
      };
    }
  }

  const result = applyConfirmation({
    key: pending.fieldKey,
    proposed: pending.proposed as ProposedValue<ProfileFieldType<ProfileFieldKey>>,
    confirmation: {
      studentRef: state.studentRef,
      presentedText,
      respondedAt: now,
      response: response.agreed
        ? { kind: "accepted" }
        : corrected !== null
          ? { kind: "corrected", correctedValue: corrected as ProfileFieldType<ProfileFieldKey> }
          : { kind: "rejected", reason: "The student said the reading was wrong." },
    },
  });

  if (isDeclined(result)) {
    return {
      kind: "declined",
      state: withoutPending(state),
      reason: result.reason,
    };
  }

  return {
    kind: response.agreed ? "confirmed" : "corrected",
    state: {
      ...withoutPending(state),
      profile: writeConfirmed(state.profile, result, now),
    },
  };
}

/**
 * Puts a value read out of a document to the student for confirmation.
 *
 * Extraction produces `ProposedValue`s. This is how one enters the interview:
 * as the pending confirmation, played back deterministically, agreed or
 * corrected by the student — the SAME path a spoken answer takes.
 *
 * There is deliberately no shortcut for documents. "It came off their passport"
 * is not confirmation: OCR misreads, a model can misread a real line, and the
 * student is the only party who knows what their passport actually says
 * (brief §2.3).
 */
export function receiveExtractedValue(
  state: InterviewState,
  fieldKey: ProfileFieldKey,
  proposed: ProposedValue<unknown>,
): InterviewState {
  return { ...state, pending: { fieldKey, proposed } };
}

/** Records a collected document. */
export function recordDocument(state: InterviewState, documentType: string): InterviewState {
  return { ...state, collectedDocuments: [...state.collectedDocuments, documentType] };
}

function writeConfirmed(
  profile: ConfirmedProfile,
  field: ConfirmedField<ProfileFieldKey>,
  now: Date,
): ConfirmedProfile {
  return confirmField(profile, field, now);
}
