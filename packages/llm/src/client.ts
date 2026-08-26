/**
 * The model port.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS IS THE ONLY PACKAGE PERMITTED TO CALL A LANGUAGE MODEL.
 * Enforced by lint: every other package is forbidden from importing a model
 * SDK (ADR-0004), and the dependency-boundary check backs it up.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── The two return types, and why the difference matters ──────────────────
 *
 *   ModelText        — the model WROTE this. Shown to a human. Never submitted.
 *                      Question wording, explanations, navigation reasoning.
 *
 *   ProposedValue<T> — the model INTERPRETED something a human said or a
 *                      document showed. Must be played back and confirmed
 *                      before it can enter the profile (ADR-0007).
 *
 * Neither can become a `ConfirmedValue`. Only the profile package's
 * confirmation step mints one, and only against a student's confirmation.
 *
 * ── Why this is a port with a fake, and not an SDK call ───────────────────
 *
 * The provider decision (Bedrock vs Anthropic API direct) and its credentials
 * are outstanding. Building against a port means the interview, extraction and
 * navigation work can be written and fully tested NOW, and the real client
 * added later as one adapter with no rework anywhere else.
 */

import type { ModelText, ProposedValue } from "@askimate/aas-domain";

/** The model could not produce a usable reading. A normal outcome, not an error. */
export interface NotUnderstood {
  readonly kind: "not_understood";
  /** Why, in terms the agent can use to ask a better next question. */
  readonly reason: string;
  /** A clarifying question, when one would help. */
  readonly clarification?: ModelText;
}

export function isNotUnderstood(value: unknown): value is NotUnderstood {
  return (value as { kind?: unknown } | null)?.kind === "not_understood";
}

/** What the agent needs a question for. */
export interface QuestionRequest {
  /** The canonical field being sought, e.g. `education.highest_qualification`. */
  readonly fieldKey: string;
  /** Human label for that field. */
  readonly label: string;
  /** Why the application needs it — so the question can explain itself. */
  readonly rationale: string;
  /** Recent turns, so the question fits the conversation rather than restarting it. */
  readonly conversationContext: readonly string[];
  /**
   * How many times this has already been asked.
   *
   * A second attempt should be phrased differently, not repeated verbatim.
   */
  readonly previousAttempts: number;
}

/** What the agent needs interpreted. */
export interface InterpretationRequest<T> {
  readonly fieldKey: string;
  readonly label: string;
  /** Exactly what the student said. */
  readonly utterance: string;
  /** A description of the shape wanted, for the model to target. */
  readonly expectedShape: string;
  /** Parses the model's raw reading into the field's type. Returns null if it cannot. */
  readonly parse: (raw: string) => T | null;
}

/** What the agent needs to ask the student to upload. */
export interface DocumentRequest {
  readonly documentType: string;
  readonly label: string;
  /** Why the application needs it. */
  readonly rationale: string;
  readonly conversationContext: readonly string[];
}

/** What the agent needs read out of a document. */
export interface ExtractionRequest<T> {
  readonly documentId: string;
  readonly documentType: string;
  readonly fieldKey: string;
  /** Text already pulled from the document (OCR or embedded text). */
  readonly documentText: string;
  readonly expectedShape: string;
  readonly parse: (raw: string) => T | null;
}

/**
 * The model client.
 *
 * Deliberately narrow: three operations, each with a return type that says what
 * the caller is allowed to do with the result. There is no general
 * `complete(prompt)` — a general escape hatch would let model output reach
 * places these types are designed to keep it out of.
 */
export interface ModelClient {
  /**
   * Composes the next question to ask the student.
   *
   * Returns `ModelText`: shown to a human, never submitted. The model is free
   * here — this is conversational navigation, the same category as deciding
   * which button advances a page.
   */
  composeQuestion(request: QuestionRequest): Promise<ModelText>;

  /**
   * Composes an ASK FOR A DOCUMENT.
   *
   * Separate from `composeQuestion` because it is a different speech act: "tell
   * me your first name" and "please upload your passport" do not share a
   * sentence shape, and forcing them through one template produces exactly the
   * kind of clumsy phrasing a student notices.
   */
  composeDocumentRequest(request: DocumentRequest): Promise<ModelText>;

  /**
   * Interprets what the student said into a structured value.
   *
   * Returns `ProposedValue` — NOT confirmed. The student must see the
   * interpretation played back and agree before it enters the profile.
   */
  interpretAnswer<T>(request: InterpretationRequest<T>): Promise<ProposedValue<T> | NotUnderstood>;

  /** Reads a value out of a document. Same rule: proposed, not confirmed. */
  extractFromDocument<T>(request: ExtractionRequest<T>): Promise<ProposedValue<T> | NotUnderstood>;
}

/** Usage, so cost per run can be measured rather than estimated. */
export interface ModelUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Wraps a client and counts what it costs.
 *
 * The Phase 0 cost model identified model inference — not browser compute — as
 * the dominant per-run cost, and recommended measuring it from Phase 3 rather
 * than estimating. This is that instrument.
 */
export class MeteredModelClient implements ModelClient {
  #calls = 0;
  #inputTokens = 0;
  #outputTokens = 0;

  public constructor(private readonly inner: ModelClient) {}

  public get usage(): ModelUsage {
    return { calls: this.#calls, inputTokens: this.#inputTokens, outputTokens: this.#outputTokens };
  }

  public async composeQuestion(request: QuestionRequest): Promise<ModelText> {
    this.#calls += 1;
    const result = await this.inner.composeQuestion(request);
    this.#outputTokens += estimateTokens(result);
    this.#inputTokens += estimateTokens(request.rationale + request.conversationContext.join(" "));
    return result;
  }

  public async composeDocumentRequest(request: DocumentRequest): Promise<ModelText> {
    this.#calls += 1;
    const result = await this.inner.composeDocumentRequest(request);
    this.#outputTokens += estimateTokens(result);
    this.#inputTokens += estimateTokens(request.rationale);
    return result;
  }

  public async interpretAnswer<T>(
    request: InterpretationRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    this.#calls += 1;
    this.#inputTokens += estimateTokens(request.utterance + request.expectedShape);
    return this.inner.interpretAnswer(request);
  }

  public async extractFromDocument<T>(
    request: ExtractionRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    this.#calls += 1;
    this.#inputTokens += estimateTokens(request.documentText);
    return this.inner.extractFromDocument(request);
  }
}

/**
 * A rough token estimate.
 *
 * Deliberately approximate and clearly named as an estimate. The real figures
 * come from the provider's usage response once a real client exists; this keeps
 * the instrument useful in the meantime rather than reporting nothing.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
