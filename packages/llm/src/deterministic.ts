/**
 * A deterministic model client.
 *
 * No network, no credentials, no variance. Given the same input it returns the
 * same output every time, which makes the whole interview loop testable today —
 * before the provider decision (Bedrock vs Anthropic API direct) is made.
 *
 * NOT a simulation of a language model, and not a fallback for production. It
 * is a stand-in that lets everything downstream be written and verified now,
 * so adding the real client later is one adapter and no rework.
 *
 * Its readings are intentionally literal. Where it cannot parse an utterance it
 * returns `not_understood` rather than guessing — the same behaviour the real
 * client must have, and the behaviour the interview loop is built around.
 */

import type { ModelText, ProposedValue } from "@askimate/aas-domain";
import { modelText, proposeValue } from "@askimate/aas-domain";

import type {
  DocumentRequest,
  ExtractionRequest,
  InterpretationRequest,
  ModelClient,
  NotUnderstood,
  QuestionRequest,
} from "./client.js";

export class DeterministicModelClient implements ModelClient {
  public composeQuestion(request: QuestionRequest): Promise<ModelText> {
    // A second attempt is rephrased rather than repeated verbatim — asking the
    // identical question again is how a conversation stops feeling like one.
    if (request.previousAttempts > 0) {
      return Promise.resolve(
        modelText(
          `Sorry — I didn't quite catch that. ${request.rationale} ` +
            `Could you tell me your ${request.label.toLowerCase()}?`,
        ),
      );
    }
    return Promise.resolve(
      modelText(`${request.rationale} What's your ${request.label.toLowerCase()}?`),
    );
  }

  public composeDocumentRequest(request: DocumentRequest): Promise<ModelText> {
    return Promise.resolve(
      modelText(
        `${request.rationale} Could you upload your ${request.label} here? ` +
          `A clear photo or a PDF is fine.`,
      ),
    );
  }

  public interpretAnswer<T>(
    request: InterpretationRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    const utterance = request.utterance.trim();

    if (utterance.length === 0) {
      return Promise.resolve({
        kind: "not_understood",
        reason: "The student said nothing.",
      });
    }

    // A student declining is NOT a parse failure. It is an answer, and one the
    // interview must handle differently — asking again would be badgering.
    if (/^(i don't know|dont know|not sure|no idea|skip|prefer not to say)\b/i.test(utterance)) {
      return Promise.resolve({
        kind: "not_understood",
        reason: "The student does not know or does not wish to answer.",
        clarification: modelText(
          "That's fine — we can come back to it. Is there anything that would help you find it?",
        ),
      });
    }

    const parsed = request.parse(utterance);
    if (parsed === null) {
      return Promise.resolve({
        kind: "not_understood",
        reason: `Could not read a ${request.expectedShape} from "${utterance}".`,
      });
    }

    return Promise.resolve(
      proposeValue({
        value: parsed,
        origin: "conversation",
        // The student's own words, carried through so the confirmation can show
        // them what they said next to what was understood.
        verbatim: utterance,
        confidence: 0.9,
      }),
    );
  }

  /**
   * Reads a labelled value out of a document's text.
   *
   * Label-directed and deliberately literal: it finds the line printed under
   * one of the labels the caller supplied, returns THAT WHOLE LINE as the
   * verbatim span, and parses the value from it. It never composes a value out
   * of several places in the document, and never returns a span it did not
   * find.
   *
   * That last property matters more than the parsing does. The grounding check
   * downstream rejects any reading whose quoted span is absent from the
   * document, so a stand-in that fabricated spans would make every test of that
   * check vacuous.
   */
  public extractFromDocument<T>(
    request: ExtractionRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    const located = locateLabelledLine(request.documentText, request.labels);

    if (located === null) {
      return Promise.resolve({
        kind: "not_understood",
        reason:
          `Found no line labelled ${request.labels.map((l) => `"${l}"`).join(" or ")} on this ` +
          `${request.documentType}. Looked for ${request.hint}.`,
      });
    }

    const parsed = request.parse(located.value);
    if (parsed === null) {
      return Promise.resolve({
        kind: "not_understood",
        reason:
          `Read "${located.value}" from the ${request.documentType}, but could not make a ` +
          `${request.expectedShape} of it.`,
      });
    }

    return Promise.resolve(
      proposeValue({
        value: parsed,
        origin: "document",
        // The whole line, exactly as the document has it.
        verbatim: located.line,
        confidence: 0.95,
        documentId: request.documentId,
      }),
    );
  }
}

interface LabelledLine {
  /** The whole line, as printed. */
  readonly line: string;
  /** What followed the label. */
  readonly value: string;
}

/**
 * Finds `Label: value` on its own line.
 *
 * Longest label first, so `Date of expiry` wins over `Date` on a document that
 * prints both — matching the shorter one would silently read the wrong field.
 */
function locateLabelledLine(text: string, labels: readonly string[]): LabelledLine | null {
  const ordered = [...labels].sort((a, b) => b.length - a.length);

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    for (const label of ordered) {
      const normalisedLine = line.toLowerCase();
      const normalisedLabel = label.toLowerCase();
      if (!normalisedLine.startsWith(normalisedLabel)) continue;

      const remainder = line.slice(label.length).trimStart();
      if (!remainder.startsWith(":") && !remainder.startsWith("/")) continue;

      const value = remainder.replace(/^[:/]\s*/, "").trim();
      if (value.length === 0) continue;

      return { line, value };
    }
  }

  return null;
}
