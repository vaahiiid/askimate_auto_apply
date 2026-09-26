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
import { proposeValue, unwrapProposed } from "@askimate/aas-domain";
import type { ModelClient, NotUnderstood } from "@askimate/aas-llm";
import { isNotUnderstood } from "@askimate/aas-llm";
import type {
  ConfirmedField,
  ConfirmedProfile,
  OrdinaryFieldKey,
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

import type { CompositeFieldSpec, FieldPart, FieldSpec, OfferedReading, PartAnswers, ListFieldSpec } from "./field-specs.js";
import { FIELD_SPECS, OMITTED, isComposite, partParser, isList, yesNo } from "./field-specs.js";

/**
 * What AskiMate Chat should do next.
 *
 * A closed union: every possible next move is one of these, so the chat layer
 * has a complete and checkable contract rather than free-form instructions.
 */
export type InterviewAction =
  /** Say this to the student, and send their reply back. */
  /** `OrdinaryFieldKey`: the interview cannot ask what this system may not hold (ADR-0102). */
  | {
      readonly kind: "ask";
      readonly say: ModelText;
      readonly fieldKey: OrdinaryFieldKey;
      /**
       * Which part of the field this asks for, when the field has several.
       *
       * Absent for a field answered in one utterance. Present so the chat
       * layer, and the log, can tell "asked again" from "asked for the next
       * part" — they look the same otherwise, and one of them is a failure.
       */
      readonly partKey?: string;
    }
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
  | {
      readonly kind: "escalate";
      readonly reason: string;
      readonly fieldKey?: ProfileFieldKey;
      /** How many times the field was asked before this stop (P224), for the words the student reads. */
      readonly attempts?: number;
    };

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
  readonly requiredFields: readonly OrdinaryFieldKey[];
  /**
   * Documents the application needs, by type.
   *
   * Supplied from `CatalogueEntry.requiredDocuments`. `nextAction` will ask for
   * one — but only once no FIELD is outstanding, and the orchestrator enters
   * the interview only WHILE a field is outstanding (`plan.blockers.length >
   * 0`). The two conditions are mutually exclusive, so `request_document` is
   * unreachable through the run driver (ADR-0064 §4, measured; ADR-0066 §5 for
   * why the capability is kept rather than deleted).
   */
  readonly requiredDocuments: readonly string[];
  /** Documents already collected and confirmed. */
  readonly collectedDocuments: readonly string[];
  readonly pending?: PendingConfirmation;
  /**
   * Parts of a composite field answered but not yet assembled, per field.
   *
   * Cleared the moment the whole value is put for confirmation, and again on
   * every outcome of that confirmation — a half-answered address left behind
   * would be asked around rather than asked for.
   */
  readonly partial: ReadonlyMap<ProfileFieldKey, PartReadings>;
  /**
   * How many times each QUESTION has been asked. Drives rephrasing and escalation.
   *
   * Keyed by the question, not the field: for a field answered in one
   * utterance those are the same thing, and for a composite the question is a
   * part (`identity.passport#expiry`). Counting per field would escalate a
   * six-part address after two readable answers and one unreadable one.
   */
  readonly attempts: ReadonlyMap<string, number>;
  /** Recent turns, so questions fit the conversation. */
  readonly transcript: readonly string[];
  /**
   * Fields whose LAST reading was set aside as a correction that could not be
   * read (P221) — nothing proposed or confirmed for them since. The next
   * question for such a field says what happened rather than "I didn't catch
   * that". Derived from the log by the driver; absent in a fresh interview.
   */
  readonly rejected?: ReadonlySet<ProfileFieldKey>;
  /**
   * The answer just given that could not be read, and why, in the student's
   * terms (P223). Set by `receiveAnswer` for the request it happens in and
   * cleared by the next reading; the question composed next opens with it.
   * Vahid, on a date-of-birth question that repeated verbatim twice: *"A
   * person here has no idea whether they typed it wrong, whether the system
   * is broken, or what shape it wants."*
   */
  readonly unread?: { readonly fieldKey: ProfileFieldKey; readonly reason: string };
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
  readonly requiredFields: readonly OrdinaryFieldKey[];
  readonly requiredDocuments: readonly string[];
}): InterviewState {
  return {
    studentRef: input.studentRef,
    profile: input.profile,
    requiredFields: input.requiredFields,
    requiredDocuments: input.requiredDocuments,
    collectedDocuments: [],
    partial: new Map(),
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

// ───────────────────────────────────────────────────────────────────────────
// Fields with several parts
// ───────────────────────────────────────────────────────────────────────────

/** The parts of one composite field that have been read, by `partKey`. */
type PartReadings = ReadonlyMap<string, ProposedValue<unknown>>;

const NO_READINGS: PartReadings = new Map();

/** The values alone, which is what `askWhen` and `assemble` are given. */
function valuesOf(readings: PartReadings): PartAnswers {
  return new Map([...readings].map(([partKey, reading]) => [partKey, unwrapProposed(reading).value]));
}

/** Names a question for the attempt count: the field, or one part of it. */
function questionKey(fieldKey: ProfileFieldKey, partKey?: string): string {
  return partKey === undefined ? fieldKey : `${fieldKey}#${partKey}`;
}

/**
 * The next part of a composite that still needs an answer.
 *
 * In spec order, skipping any part the answers so far make inapplicable — a
 * student who has just said they have no passport is not then asked for its
 * number (ADR-0117).
 */
function nextPart(
  spec: CompositeFieldSpec<unknown>,
  readings: PartReadings,
): FieldPart<unknown> | undefined {
  const answered = valuesOf(readings);
  return spec.parts.find(
    (part) => !readings.has(part.partKey) && (part.askWhen?.(answered) ?? true),
  );
}

/**
 * A question there is something to ask: the whole field, or one part of it.
 *
 * `suffix` is what the question is called beside the field's label — `expiry`
 * for a composite's part, `job 1 — employer` for a list entry's, `another job`
 * for the question after an entry — so the student is told which thing they
 * are being asked for, and the log can tell "asked again" from "asked next".
 */
type OpenQuestion =
  | { readonly kind: "field"; readonly spec: FieldSpec<unknown> }
  | { readonly kind: "part"; readonly part: FieldPart<unknown>; readonly suffix: string };

// ───────────────────────────────────────────────────────────────────────────
// Fields whose value is a list (ADR-0113)
// ───────────────────────────────────────────────────────────────────────────
//
// A list's walk is a sequence of parts like a composite's, keyed so the log
// can hold it with no new event kind (`value_part_read` carries a part key):
//
//   any               "is there anything to list?"         yes / no
//   item0.<partKey>   the first entry's parts, in the item spec's order
//   item0.another     "is there another?"                  yes / no
//   item1.<partKey>   …
//
// The walk ends at `any = no`, or at the first `itemN.another = no`. Then the
// whole list is assembled and put for ONE confirmation.

const ANY = "any";
const ANOTHER = "another";

function itemKey(index: number, partKey: string): string {
  return `item${String(index)}.${partKey}`;
}

/** The readings of one entry, with the entry's prefix stripped off. */
function readingsOfItem(readings: PartReadings, index: number): PartReadings {
  const prefix = `item${String(index)}.`;
  return new Map(
    [...readings]
      .filter(([partKey]) => partKey.startsWith(prefix) && partKey !== itemKey(index, ANOTHER))
      .map(([partKey, reading]) => [partKey.slice(prefix.length), reading] as const),
  );
}

function yesNoPart(partKey: string, rationale: string): FieldPart<unknown> {
  return { partKey, rationale, expectedShape: "yes or no", parse: yesNo };
}

/** The next question of a list's walk, or `undefined` once the list is complete. */
function nextListQuestion(
  spec: ListFieldSpec<unknown>,
  readings: PartReadings,
): { readonly part: FieldPart<unknown>; readonly suffix: string } | undefined {
  const values = valuesOf(readings);
  if (!readings.has(ANY)) {
    return { part: yesNoPart(ANY, spec.anyRationale), suffix: `any ${spec.itemLabel} to list` };
  }
  if (values.get(ANY) !== true) return undefined;
  for (let index = 0; ; index++) {
    const part = nextPart(spec.item, readingsOfItem(readings, index));
    if (part !== undefined) {
      return {
        part: { ...part, partKey: itemKey(index, part.partKey) },
        suffix: `${spec.itemLabel} ${String(index + 1)} — ${part.partKey}`,
      };
    }
    const another = itemKey(index, ANOTHER);
    if (!readings.has(another)) {
      return { part: yesNoPart(another, spec.anotherRationale), suffix: `another ${spec.itemLabel}` };
    }
    if (values.get(another) !== true) return undefined;
  }
}

/**
 * The whole list from its walk, or `null` when an entry does not assemble —
 * which, as for a composite, is a defect in the spec and not in the answers.
 */
function assembleList(spec: ListFieldSpec<unknown>, readings: PartReadings): readonly unknown[] | null {
  const values = valuesOf(readings);
  if (values.get(ANY) !== true) return [];
  const items: unknown[] = [];
  for (let index = 0; readings.has(itemKey(index, ANOTHER)); index++) {
    const item = spec.item.assemble(valuesOf(readingsOfItem(readings, index)));
    if (item === null) return null;
    items.push(item);
    if (values.get(itemKey(index, ANOTHER)) !== true) break;
  }
  return items;
}

/** The open question of a composite or a list, from its readings so far. */
function nextQuestionOf(
  spec: CompositeFieldSpec<unknown> | ListFieldSpec<unknown>,
  readings: PartReadings,
): { readonly part: FieldPart<unknown>; readonly suffix: string } | undefined {
  if (isList(spec)) return nextListQuestion(spec, readings);
  const part = nextPart(spec, readings);
  return part === undefined ? undefined : { part, suffix: part.partKey };
}

/** What a field is currently waiting to be asked. */
type Question =
  | OpenQuestion
  /** No spec: the interview stops rather than improvising a question (ADR-0007). */
  | { readonly kind: "undefined_field" }
  /**
   * Every applicable part is answered and nothing is pending.
   *
   * Unreachable by design — `receiveAnswer` puts the assembled value for
   * confirmation on the same call that answers the last part, and every exit
   * from `receiveConfirmation` clears the parts. Named and reported rather
   * than silently re-asked, because the alternative is a loop the student
   * cannot get out of.
   */
  | { readonly kind: "stranded" };

function questionFor(state: InterviewState, fieldKey: ProfileFieldKey): Question {
  const spec = specFor(fieldKey);
  if (spec === undefined) return { kind: "undefined_field" };
  if (!isComposite(spec) && !isList(spec)) return { kind: "field", spec };

  const next = nextQuestionOf(spec, state.partial.get(fieldKey) ?? NO_READINGS);
  return next === undefined ? { kind: "stranded" } : { kind: "part", ...next };
}

/** Forgets the parts read for one field. */
function withoutParts(state: InterviewState, fieldKey: ProfileFieldKey): InterviewState {
  const partial = new Map(state.partial);
  partial.delete(fieldKey);
  return { ...state, partial };
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
  // What each outstanding field is waiting to be asked. For a composite that
  // is one PART, so a six-part address is six questions rather than one asked
  // six times — and the attempt count, which escalates, counts the right thing.
  const asking = outstanding.map((fieldKey) => ({ fieldKey, question: questionFor(state, fieldKey) }));

  const undefinedField = asking.find((candidate) => candidate.question.kind === "undefined_field");
  if (undefinedField !== undefined) {
    return {
      kind: "escalate",
      fieldKey: undefinedField.fieldKey,
      reason:
        `No question is defined for "${undefinedField.fieldKey}". The agent will not improvise ` +
        `one for a field it does not understand.`,
    };
  }

  const stranded = asking.find((candidate) => candidate.question.kind === "stranded");
  if (stranded !== undefined) {
    return {
      kind: "escalate",
      fieldKey: stranded.fieldKey,
      reason:
        `Every part of "${FIELD_LABELS[stranded.fieldKey]}" has been answered, but the value was ` +
        `never put to the student for confirmation and cannot now be. Re-asking would lose the ` +
        `answers already given, so a specialist should look at this.`,
    };
  }

  // Past the two returns above, every remaining question is one that can be
  // asked. Said in the types rather than left to the reader.
  const askable = asking.filter(
    (candidate): candidate is { fieldKey: OrdinaryFieldKey; question: OpenQuestion } =>
      candidate.question.kind === "field" || candidate.question.kind === "part",
  );

  const partKeyOf = (question: OpenQuestion): string | undefined =>
    question.kind === "part" ? question.part.partKey : undefined;

  // ═══════════════════════════════════════════════════════════════════════
  // ONE selection, and it is the first outstanding field (P224, ADR-0145).
  //
  // Until P224 this was `askable.find(attempts < MAX)`: a field at the limit
  // was SKIPPED and the next one asked, so a required field could be left
  // behind without a word and the interview escalated only once every field
  // was exhausted. Vahid met it on his own date of birth. His condition:
  // *"Nothing required may ever be skipped, by any path, for any reason …
  // Make that a structural property rather than a branch someone could add
  // an exception to later."* So there is no predicate over attempts here at
  // all: the first outstanding field is the one asked, or the one stopped
  // on, and nothing else is consulted. The run itself was never able to
  // pass an unfilled required field — the plan refuses to build with a
  // blocker — but the interview could walk past one, and now cannot.
  // ═══════════════════════════════════════════════════════════════════════
  const first = askable[0];
  if (first !== undefined) {
    const attemptsSoFar = state.attempts.get(questionKey(first.fieldKey, partKeyOf(first.question))) ?? 0;
    if (attemptsSoFar >= MAX_ATTEMPTS_PER_FIELD) {
      const label = FIELD_LABELS[first.fieldKey];
      const partKey = partKeyOf(first.question);
      return {
        kind: "escalate",
        fieldKey: first.fieldKey,
        attempts: attemptsSoFar,
        reason:
          `Asked for "${partKey === undefined ? label : `${label} — ${partKey}`}" ` +
          `${String(attemptsSoFar)} times without obtaining a usable answer. The interview ` +
          `stops here rather than skipping a required field: a specialist should look at this ` +
          `rather than the application proceeding without it.`,
      };
    }
    const { fieldKey, question } = first;
    const partKey = partKeyOf(question);
    const label = FIELD_LABELS[fieldKey];
    const say = await model.composeQuestion({
      fieldKey: questionKey(fieldKey, partKey),
      // A part names itself: "Passport — expiry", "Employment history — job 1
      // — employer". The student is being asked for one thing, and the label
      // says which thing, not just which field.
      label: question.kind === "part" ? `${label} — ${question.suffix}` : label,
      rationale: question.kind === "part" ? question.part.rationale : question.spec.rationale,
      conversationContext: state.transcript.slice(-6),
      previousAttempts: state.attempts.get(questionKey(fieldKey, partKey)) ?? 0,
      ...(state.rejected?.has(fieldKey) === true ? { previousReadingRejected: true } : {}),
      ...(state.unread?.fieldKey === fieldKey ? { previousAnswerUnread: state.unread.reason } : {}),
    });

    return { kind: "ask", say, fieldKey, ...(partKey === undefined ? {} : { partKey }) };
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

/** One of the readings an answer could have, offered to the student (P225, ADR-0146). */
export interface ReadingOnOffer {
  /** `r1`, `r2`, …: what the pick names. */
  readonly id: string;
  /** The reading in the student's terms. */
  readonly label: string;
  /** The reading as it would be proposed if picked — the student's own words carried with it. */
  readonly proposed: ProposedValue<unknown>;
}

/** What happened to a student's reply. */
export type ReplyOutcome =
  | { readonly kind: "understood"; readonly state: InterviewState }
  | { readonly kind: "not_understood"; readonly state: InterviewState; readonly reason: string }
  /**
   * The answer reads more than one way and the student is offered the
   * readings to pick from (P225). Not an attempt: the count belongs to the
   * asking, and nothing was asked again. Vahid: *"The pick is an answer to
   * the open question, not a new question."*
   */
  | {
      readonly kind: "ambiguous";
      readonly state: InterviewState;
      readonly fieldKey: ProfileFieldKey;
      readonly partKey?: string;
      readonly readings: readonly ReadingOnOffer[];
    }
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
  const label = FIELD_LABELS[fieldKey];

  // ── A field answered in one utterance ──────────────────────────────────
  if (!isComposite(spec) && !isList(spec)) {
    const attempts = new Map(state.attempts);
    attempts.set(fieldKey, (attempts.get(fieldKey) ?? 0) + 1);

    const read: ProposedValue<unknown> | NotUnderstood = await model.interpretAnswer({
      fieldKey,
      label,
      utterance,
      expectedShape: spec.expectedShape,
      parse: spec.parse,
    });

    // The attempt still counts. Otherwise a student who keeps answering
    // unusably would be asked forever, and the escalation would never fire.
    if (isNotUnderstood(read)) {
      // More than one reading: offer them, spend nothing (P225).
      const offered = read.clarification === undefined ? readingsOf(spec.readings, utterance) : [];
      if (offered.length >= 2) {
        return { kind: "ambiguous", state: { ...state, transcript }, fieldKey, readings: offered };
      }
      // What the student reads next: the spec's own account of why THIS
      // utterance was refused where it has one, else what could not be read
      // from what they wrote. Never a shape to type instead (P223).
      // A decline ("I don't know") is not a parse failure: the model's own
      // reason stands, and its clarification is what the student reads.
      const opening =
        read.clarification !== undefined
          ? `${read.clarification}`
          : (spec.explainRefusal?.(utterance) ?? `I could not read ${spec.expectedShape} from "${utterance}".`);
      return {
        kind: "not_understood",
        state: { ...state, transcript, attempts, unread: { fieldKey, reason: opening } },
        reason: read.clarification !== undefined ? read.reason : opening,
      };
    }
    const { unread: _cleared, ...rest } = state;
    return {
      kind: "understood",
      state: { ...rest, transcript, attempts, pending: { fieldKey, proposed: read } },
    };
  }

  // ── A field answered part by part ──────────────────────────────────────
  //
  // Which part this answers is derived from the state rather than passed in:
  // the caller answers "the question that was just asked", and only the state
  // knows which part that was.
  const open = nextQuestionOf(spec, state.partial.get(fieldKey) ?? NO_READINGS);
  if (open === undefined) {
    return {
      kind: "not_understood",
      state,
      reason: `Every part of "${label}" has already been answered; there is no question open.`,
    };
  }
  const question = open.part;

  const attempts = new Map(state.attempts);
  const asked = questionKey(fieldKey, question.partKey);
  attempts.set(asked, (attempts.get(asked) ?? 0) + 1);

  const interpreted: ProposedValue<unknown> | NotUnderstood = await model.interpretAnswer({
    fieldKey: asked,
    label: `${label} — ${open.suffix}`,
    utterance,
    expectedShape: question.expectedShape,
    parse: partParser(question),
  });

  if (isNotUnderstood(interpreted)) {
    // More than one reading of this part: offer them, spend nothing (P225).
    const offered = interpreted.clarification === undefined ? readingsOf(question.readings, utterance) : [];
    if (offered.length >= 2) {
      return { kind: "ambiguous", state: { ...state, transcript }, fieldKey, partKey: question.partKey, readings: offered };
    }
    // The part stays unanswered, so the SAME part is asked again: an
    // unreadable expiry is not a reason to move on with the expiry left blank.
    return {
      kind: "not_understood",
      state: { ...state, transcript, attempts },
      reason: interpreted.reason,
    };
  }

  return withPartRead(state, spec, fieldKey, question.partKey, interpreted, transcript, attempts);
}

/**
 * The readings an utterance has, as proposals in the student's own words —
 * empty unless there are at least two, which is the only case that is offered.
 */
function readingsOf(
  readings: ((raw: string) => readonly OfferedReading<unknown>[]) | undefined,
  utterance: string,
): readonly ReadingOnOffer[] {
  const found = readings?.(utterance) ?? [];
  if (found.length < 2) return [];
  return found.map((reading, index) => ({
    id: `r${String(index + 1)}`,
    label: reading.label,
    proposed: proposeValue({ value: reading.value, origin: "conversation", verbatim: utterance, confidence: 0.9 }),
  }));
}

/**
 * The student picked one of the readings offered (P225): the pick is their
 * own statement of the value, so it goes where an understood answer goes —
 * pending for a scalar, or read as the part it answers.
 */
export function chooseReading(
  state: InterviewState,
  fieldKey: ProfileFieldKey,
  partKey: string | undefined,
  proposed: ProposedValue<unknown>,
): ReplyOutcome {
  const spec = specFor(fieldKey);
  if (spec === undefined) {
    return { kind: "not_understood", state, reason: `No field specification for "${fieldKey}".` };
  }
  if (partKey === undefined) {
    const { unread: _cleared, ...rest } = state;
    return { kind: "understood", state: { ...rest, pending: { fieldKey, proposed } } };
  }
  if (!isComposite(spec) && !isList(spec)) {
    return { kind: "not_understood", state, reason: `"${fieldKey}" has no part "${partKey}".` };
  }
  const open = nextQuestionOf(spec, state.partial.get(fieldKey) ?? NO_READINGS);
  if (open === undefined || open.part.partKey !== partKey) {
    return { kind: "not_understood", state, reason: `"${fieldKey}" is not waiting on part "${partKey}".` };
  }
  return withPartRead(state, spec, fieldKey, partKey, proposed, state.transcript, state.attempts);
}

/** A part read: held with the others, or, when it was the last, the whole put for confirmation. */
function withPartRead(
  state: InterviewState,
  spec: CompositeFieldSpec<unknown> | ListFieldSpec<unknown>,
  fieldKey: ProfileFieldKey,
  partKey: string,
  interpreted: ProposedValue<unknown>,
  transcript: readonly string[],
  attempts: ReadonlyMap<string, number>,
): ReplyOutcome {
  const label = FIELD_LABELS[fieldKey];
  const readings: PartReadings = new Map([
    ...(state.partial.get(fieldKey) ?? NO_READINGS),
    [partKey, interpreted],
  ]);

  // More parts to ask: hold what has been read and carry on. Nothing is put
  // for confirmation yet, because the student confirms the WHOLE value — for
  // a list, the whole list.
  if (nextQuestionOf(spec, readings) !== undefined) {
    const partial = new Map(state.partial).set(fieldKey, readings);
    return { kind: "understood", state: { ...state, transcript, attempts, partial } };
  }

  const whole = isList(spec) ? assembleList(spec, readings) : spec.assemble(valuesOf(readings));
  if (whole === null) {
    // Every part was readable and they still do not make a value. That is a
    // defect in the spec, not in what the student said, and saying so beats
    // storing a value with a part nobody gave it. The parts are dropped so the
    // field is asked again from the beginning rather than left stranded.
    return {
      kind: "not_understood",
      state: { ...withoutParts(state, fieldKey), transcript, attempts },
      reason:
        `Read every part of "${label}", but they do not make a complete ${label.toLowerCase()}.`,
    };
  }

  return {
    kind: "understood",
    state: {
      ...withoutParts(state, fieldKey),
      transcript,
      attempts,
      pending: { fieldKey, proposed: wholeOf(whole, readings) },
    },
  };
}

/**
 * The assembled value as one proposal, carrying every part the student said.
 *
 * `verbatim` is the parts' own words, each under its name, because that is
 * what the confirmation shows back: *"You said: …"* has to be true of a value
 * built from six answers as much as of one built from a single sentence.
 *
 * The confidence is the LOWEST of the parts. A value is no better read than
 * its worst-read part, and averaging would let five confident parts bury a
 * doubtful one — which is the direction that ends with a wrong passport number
 * nobody looked at.
 */
function wholeOf(value: unknown, readings: PartReadings): ProposedValue<unknown> {
  const parts = [...readings].map(([partKey, reading]) => ({ partKey, ...unwrapProposed(reading) }));
  return proposeValue({
    value,
    origin: "conversation",
    verbatim: parts
      .filter((part) => part.value !== OMITTED)
      .map((part) => `${part.partKey}: ${part.verbatim}`)
      .join("; "),
    confidence: parts.reduce((lowest, part) => Math.min(lowest, part.confidence), 1),
  });
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
    // A composite has no whole-value parser, and inventing one here would be
    // the failure this phase exists to avoid: "no, flat 4" could be a new
    // first line or a new second line, and choosing between them is us
    // supplying an answer. So the field is asked again, part by part.
    if (isComposite(spec)) {
      return {
        kind: "not_understood",
        state: withoutParts(withoutPending(state), pending.fieldKey),
        reason:
          `"${label}" is made of several parts, and "${response.correction}" cannot be read as a ` +
          `correction to the whole of it without guessing which part changed. It will be asked ` +
          `for again, part by part.`,
      };
    }
    // The same rule for a list, one level up: which entry, and which part of
    // it, a correction names is not ours to decide (ADR-0113).
    if (isList(spec)) {
      return {
        kind: "not_understood",
        state: withoutParts(withoutPending(state), pending.fieldKey),
        reason:
          `"${label}" is a list collected entry by entry, and "${response.correction}" cannot be ` +
          `read as a correction to the whole of it without guessing which entry changed. It will ` +
          `be asked for again, entry by entry.`,
      };
    }
    corrected = spec.parse(response.correction);
    if (corrected === null) {
      return {
        kind: "not_understood",
        state: withoutPending(state),
        // P199: no article — the shape carries its own. See deterministic.ts.
        reason: `Could not read ${spec.expectedShape} from the correction "${response.correction}".`,
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

  // Whatever the student said, the parts read for this field are finished
  // with: stored, corrected or refused, the walk that produced them is over.
  // Leaving them would strand the field — `questionFor` would find no part to
  // ask and no value to confirm.
  const settled = withoutParts(withoutPending(state), pending.fieldKey);

  if (isDeclined(result)) {
    return {
      kind: "declined",
      state: settled,
      reason: result.reason,
    };
  }

  return {
    kind: response.agreed ? "confirmed" : "corrected",
    state: {
      ...settled,
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
