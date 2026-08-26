/**
 * The Amazon Bedrock adapter.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONLY CODE IN THIS SYSTEM THAT TALKS TO A REAL LANGUAGE MODEL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * It implements `ModelClient` and nothing else, so swapping providers later is
 * one file. The interview, extraction, mapping and navigation layers do not
 * know Bedrock exists — that was the point of building against a port before
 * the provider decision was made (ADR-0018).
 *
 * ── What this adapter is allowed to return ────────────────────────────────
 *
 * The port's return types are the guarantee, and they hold here exactly as they
 * hold for the deterministic stand-in:
 *
 *   composeQuestion / composeDocumentRequest → ModelText
 *       The model WROTE this. Shown to a human. Cannot reach a form field.
 *
 *   interpretAnswer / extractFromDocument    → ProposedValue | NotUnderstood
 *       The model INTERPRETED something. Must be confirmed by the student
 *       before it enters the profile.
 *
 * There is no method here that returns a `ConfirmedValue`, and no way to build
 * one from this package. That is enforced by the type system, not by this
 * comment (ADR-0004).
 *
 * ── Why strict tool use rather than free text ─────────────────────────────
 *
 * Interpretation and extraction ask the model for a STRUCTURED answer, via a
 * strict-schema tool with a forced `tool_choice`. Parsing a value out of prose
 * means writing a parser for the model's phrasing, and that parser becomes a
 * second, undocumented place where a student's date of birth can be misread.
 *
 * The model's structured answer is still not trusted:
 *
 *   • `value` is parsed by the caller's DETERMINISTIC parser, and a value that
 *     will not parse is `not_understood` rather than an approximation
 *     (`packages/interview/src/field-specs.ts`)
 *   • `verbatim` is checked against the document, and a span the document does
 *     not contain means the whole reading is DISCARDED, at any confidence
 *     (`packages/extraction/src/grounding.ts`, ADR-0016)
 *   • `confidence` can send a reading to a human. It can never promote one.
 *
 * The schema makes the model's answer legible. The checks above are what make
 * it safe.
 */

import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { ModelText, ProposedValue } from "@askimate/aas-domain";
import { modelText } from "@askimate/aas-domain";

import type { BedrockConfig, ModelWorkload } from "./bedrock-config.js";
import type { ReadingToolInput } from "./bedrock-reading.js";
import { toProposal } from "./bedrock-reading.js";
import type {
  DocumentRequest,
  ExtractionRequest,
  InterpretationRequest,
  ModelClient,
  ModelUsage,
  NotUnderstood,
  QuestionRequest,
} from "./client.js";

/**
 * How the agent must behave, in every call.
 *
 * Deliberately short. A long list of prohibitions is not what keeps model
 * output out of an application — the types are. This says the few things that
 * genuinely change the model's behaviour for the better, and leaves the
 * guarantees to the code that enforces them.
 */
const SYSTEM_RULES = [
  "You are helping a student apply to a university. You never invent information.",
  "If you do not know something, say so. A missing answer is always better than a plausible one:",
  "someone will ask the student, and that costs a question. A wrong answer costs them a place.",
].join(" ");

/** The structured answer both interpretation and extraction ask for. */
const READING_TOOL_NAME = "record_reading";

function readingTool(expectedShape: string, quoting: "utterance" | "document"): Anthropic.Tool {
  return {
    name: READING_TOOL_NAME,
    description:
      `Record what you read. Expected shape: ${expectedShape}. ` +
      (quoting === "document"
        ? `"verbatim" MUST be copied EXACTLY from the document, character for character — ` +
          `the whole line containing the value. A quoted span that is not in the document ` +
          `causes the reading to be discarded.`
        : `"verbatim" MUST be the student's own words, exactly as they said them.`),
    // Strict schema: the model's answer validates or the call fails. Available
    // on Bedrock (structured outputs / strict tool use).
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        understood: {
          type: "boolean",
          description: "False when you cannot read the value. Not a failure — a normal outcome.",
        },
        value: {
          type: ["string", "null"],
          description: `The value you read, as text matching: ${expectedShape}. Null if not understood.`,
        },
        verbatim: {
          type: ["string", "null"],
          description:
            quoting === "document"
              ? "The exact line from the document that this came from. Copied, not paraphrased."
              : "The student's own words. Copied, not paraphrased.",
        },
        confidence: {
          type: ["number", "null"],
          description: "0 to 1. How sure you are of this reading.",
        },
        reason: {
          type: ["string", "null"],
          description: "When not understood, why — in terms that help ask a better question.",
        },
      },
      required: ["understood", "value", "verbatim", "confidence", "reason"],
    },
  };
}

export interface BedrockClientOptions {
  readonly config: BedrockConfig;
  /**
   * Maximum tokens per response.
   *
   * Question composition needs very little; the default is generous enough for
   * a paragraph and small enough that a runaway response cannot cost much.
   */
  readonly maxTokens?: number;
}

/**
 * A `ModelClient` backed by Amazon Bedrock.
 *
 * Usage figures here are the provider's own, not estimates — which is what the
 * Phase 0 cost model asked for. Prefer `client.usage` over wrapping this in
 * `MeteredModelClient`, whose figures are deliberately approximate.
 */
export class BedrockModelClient implements ModelClient {
  readonly #client: AnthropicBedrockMantle;
  readonly #config: BedrockConfig;
  readonly #maxTokens: number;

  #calls = 0;
  #inputTokens = 0;
  #outputTokens = 0;
  #cacheReadTokens = 0;

  public constructor(options: BedrockClientOptions) {
    this.#config = options.config;
    this.#maxTokens = options.maxTokens ?? 2_048;
    this.#client = new AnthropicBedrockMantle({ awsRegion: options.config.region });
  }

  /** Real usage, from the provider. */
  public get usage(): ModelUsage & { readonly cacheReadTokens: number } {
    return {
      calls: this.#calls,
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      cacheReadTokens: this.#cacheReadTokens,
    };
  }

  public get region(): string {
    return this.#config.region;
  }

  public modelFor(workload: ModelWorkload): string {
    return this.#config.models[workload];
  }

  // ── Composing text for a human ──────────────────────────────────────────

  public async composeQuestion(request: QuestionRequest): Promise<ModelText> {
    const rephrase =
      request.previousAttempts > 0
        ? `\n\nYou have already asked this ${String(request.previousAttempts)} time(s) and the ` +
          `answer was not usable. Ask differently — do not repeat yourself, and do not make the ` +
          `student feel they got it wrong.`
        : "";

    const text = await this.#text("interview", [
      {
        role: "user",
        content:
          `Ask the student for one piece of information, in one short conversational turn.\n\n` +
          `What is needed: ${request.label}\n` +
          `Why the application needs it: ${request.rationale}\n` +
          `Recent conversation:\n${formatContext(request.conversationContext)}\n` +
          `Ask for this and nothing else. A list of questions is a form, and the student must ` +
          `never be given a form.${rephrase}`,
      },
    ]);

    // ModelText. Shown to a human, never submitted.
    return modelText(text);
  }

  public async composeDocumentRequest(request: DocumentRequest): Promise<ModelText> {
    const text = await this.#text("interview", [
      {
        role: "user",
        content:
          `Ask the student to upload a document, in one short conversational turn.\n\n` +
          `Document: ${request.label}\n` +
          `Why the application needs it: ${request.rationale}\n` +
          `Recent conversation:\n${formatContext(request.conversationContext)}\n` +
          `Say what a good copy looks like if it helps. Do not ask for anything else.`,
      },
    ]);
    return modelText(text);
  }

  // ── Reading a value ─────────────────────────────────────────────────────

  public async interpretAnswer<T>(
    request: InterpretationRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    const reading = await this.#read(
      "interpretation",
      readingTool(request.expectedShape, "utterance"),
      `The student was asked for: ${request.label}\n` +
        `They said: "${request.utterance}"\n\n` +
        `Read the value they gave, if they gave one. If they declined, said they do not know, ` +
        `or answered something else, that is "not understood" with a reason — it is not a ` +
        `failure and you must not guess on their behalf.`,
    );

    return toProposal({
      reading,
      parse: request.parse,
      origin: "conversation",
      fallbackVerbatim: request.utterance,
    });
  }

  public async extractFromDocument<T>(
    request: ExtractionRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    const reading = await this.#read(
      "document_extraction",
      readingTool(request.expectedShape, "document"),
      `Read one value from this ${request.documentType}.\n\n` +
        `Looking for: ${request.hint}\n` +
        `Usually printed under: ${request.labels.join(", ")}\n\n` +
        `Copy the exact line it appears on into "verbatim". If the document does not contain ` +
        `this value, say so — do not reconstruct it from what such documents usually say.\n\n` +
        `--- DOCUMENT TEXT ---\n${request.documentText}\n--- END ---`,
      // The document is the expensive, repeated part of the prompt: several
      // fields are read from the same text. Cached explicitly, because Bedrock
      // does not do automatic caching.
      { cacheDocument: true },
    );

    return toProposal({
      reading,
      parse: request.parse,
      origin: "document",
      fallbackVerbatim: request.documentText.slice(0, 200),
      documentId: request.documentId,
    });
  }

  // ── Internals ───────────────────────────────────────────────────────────

  /** One call returning prose. */
  async #text(workload: ModelWorkload, messages: Anthropic.MessageParam[]): Promise<string> {
    const response = await this.#client.messages.create({
      model: this.#config.models[workload],
      max_tokens: this.#maxTokens,
      system: SYSTEM_RULES,
      // Composing a question is navigation, not data — cheap thinking is right.
      output_config: { effort: "low" },
      messages,
    });

    this.#record(response);

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (text.length === 0) {
      throw new BedrockEmptyResponseError(this.#config.models[workload], response.stop_reason);
    }
    return text;
  }

  /** One call returning a structured reading. */
  async #read(
    workload: ModelWorkload,
    tool: Anthropic.Tool,
    prompt: string,
    options: { readonly cacheDocument?: boolean } = {},
  ): Promise<ReadingToolInput> {
    const response = await this.#client.messages.create({
      model: this.#config.models[workload],
      max_tokens: this.#maxTokens,
      system: SYSTEM_RULES,
      output_config: { effort: "low" },
      tools: [tool],
      // Forced: this call exists to produce one structured reading, and a
      // conversational reply instead would be an unhandled shape.
      tool_choice: { type: "tool", name: READING_TOOL_NAME },
      messages: [
        {
          role: "user",
          content: options.cacheDocument === true
            ? [{ type: "text", text: prompt, cache_control: { type: "ephemeral" } }]
            : prompt,
        },
      ],
    });

    this.#record(response);

    const call = response.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === "tool_use" && block.name === READING_TOOL_NAME,
    );

    if (call === undefined) {
      throw new BedrockEmptyResponseError(this.#config.models[workload], response.stop_reason);
    }

    // Parsed, never string-matched: models differ in how they escape JSON, and
    // the SDK has already decoded this into an object.
    return call.input as ReadingToolInput;
  }

  #record(response: Anthropic.Message): void {
    this.#calls += 1;
    this.#inputTokens += response.usage.input_tokens;
    this.#outputTokens += response.usage.output_tokens;
    this.#cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
  }
}

/**
 * The model returned nothing usable.
 *
 * Its own error type because the response is different from a bad reading: a
 * bad reading is a normal outcome the interview handles by asking again, and
 * this is a fault to retry or escalate.
 */
export class BedrockEmptyResponseError extends Error {
  public override readonly name = "BedrockEmptyResponseError";
  public constructor(
    public readonly model: string,
    public readonly stopReason: string | null,
  ) {
    super(
      `Model ${model} returned no usable content (stop_reason: ${stopReason ?? "none"}). ` +
        `Nothing was read, and nothing was assumed.`,
    );
  }
}

function formatContext(context: readonly string[]): string {
  return context.length === 0 ? "  (nothing yet — this is the first question)" : context.map((line) => `  ${line}`).join("\n");
}
