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
  Segmentation,
  SegmentationRequest,
} from "./client.js";

export class DeterministicModelClient implements ModelClient {
  public composeQuestion(request: QuestionRequest): Promise<ModelText> {
    // The words are the spec's own (P255): the rationale, then the authored
    // question, situated by the entry it is about when it is a list's part.
    // Nothing here is built from a label — "What's your currently living in
    // the uk?" was, and Vahid answered it with a country.
    const question = `${request.rationale} ${request.question}`;
    const situated = request.about === undefined ? question : `For ${request.about}: ${question}`;
    if (request.exactly !== undefined) {
      return Promise.resolve(
        modelText(request.previousAnswerUnread === undefined ? request.exactly : `${request.previousAnswerUnread} ${request.exactly}`),
      );
    }
    // P221: the reading was set aside because the student's message was taken
    // as a correction and could not be read as one. Said as what happened —
    // "I didn't catch that" would be untrue, and a student told so retypes
    // the same value.
    // P223: what happened to what they typed, first; then the question.
    if (request.previousAnswerUnread !== undefined) {
      return Promise.resolve(modelText(`${request.previousAnswerUnread} ${situated}`));
    }
    if (request.previousReadingRejected === true) {
      return Promise.resolve(
        modelText(
          `I read your last message as a correction to what I had recorded, and I could not make ` +
            `a ${request.label.toLowerCase()} out of it, so I have set that reading aside. If what I recorded was right, ` +
            `tell me it again; if it was not, tell me the right one. ${situated}`,
        ),
      );
    }
    // A second attempt is prefaced rather than repeated bare — asking the
    // identical question again is how a conversation stops feeling like one.
    if (request.previousAttempts > 0) {
      return Promise.resolve(modelText(`Sorry — I didn't quite catch that. ${situated}`));
    }
    return Promise.resolve(modelText(situated));
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
      // P199: no article here. Every `expectedShape` carries its own ("a
      // date of birth, e.g. …", "yes or no", "the country you were born
      // in"), so prefixing one produced "Could not read a a date of birth"
      // in a sentence the STUDENT reads. Visible in the end-to-end
      // transcript since P191 and read past every time.
        reason: `Could not read ${request.expectedShape} from "${utterance}".`,
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
  /**
   * The stand-in's cut: crude but real (Vahid, 2026-09-28: *"if the
   * segmentation can be given a deterministic mode that cuts on something
   * crude but real, we can at least see whether the pipeline downstream of
   * the cut works without spending anything"*).
   *
   * The scope — the section a heading found, else the whole document — is
   * cut into BLOCKS at blank lines and at lines opening with one of the
   * entry's labels. A block is an entry when it carries a DATE RANGE — "Sep
   * 2019 – Aug 2021", "2019 - Present", "March 2015 to June 2019" — because
   * a real CV puts the dates beside each job, or when it opens with a label,
   * which is what a fixture does. A block with neither belongs to no entry.
   * Nothing here reads what is inside a block; nothing here knows a cover
   * letter from a job. What it gets wrong, the checks and the measurement
   * name.
   */
  public segmentDocument(request: SegmentationRequest): Promise<Segmentation | NotUnderstood> {
    const from = request.section?.from ?? 1;
    const to = request.section?.to ?? request.lines.length;
    const blocks: { from: number; to: number }[] = [];
    let open: { from: number; to: number } | null = null;
    for (let number = from; number <= to; number += 1) {
      const line = request.lines[number - 1] ?? "";
      const blank = line.trim().length === 0;
      if (blank) {
        open = null;
        continue;
      }
      if (open === null || opensWithLabel(line, request.entryLabels)) {
        open = { from: number, to: number };
        blocks.push(open);
      } else {
        open.to = number;
      }
    }
    const entries = blocks.filter((block) =>
      request.lines.slice(block.from - 1, block.to).some((line) => DATE_RANGE.test(line) || opensWithLabel(line, request.entryLabels)),
    );
    if (entries.length === 0) {
      return Promise.resolve({
        kind: "not_understood",
        reason:
          `No block between lines ${String(from)} and ${String(to)} carries a date range or opens with ` +
          `${request.entryLabels.map((l) => `"${l}"`).join(" or ")}, so the stand-in finds no ${request.kind}.`,
      });
    }
    return Promise.resolve({ entries });
  }

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

/**
 * A date range on one line: a month-and-year or a year, a dash or "to", and a
 * month-and-year, a year, or a word for "still here".
 */
const MONTH = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
const POINT = `(?:${MONTH}\\s+)?(?:19|20)\\d{2}|(?:0?[1-9]|1[0-2])[/.](?:19|20)\\d{2}`;
const DATE_RANGE = new RegExp(
  `\\b(?:${POINT})\\s*(?:[-–—]|to|until|till)\\s*(?:(?:${POINT})|present|current|now|date|ongoing|today)\\b`,
  "i",
);

function opensWithLabel(line: string, labels: readonly string[]): boolean {
  const trimmed = line.trim().toLowerCase();
  return labels.some((label) => {
    const bare = label.toLowerCase();
    return trimmed.startsWith(bare) && /^[:/]/.test(trimmed.slice(bare.length).trimStart());
  });
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
