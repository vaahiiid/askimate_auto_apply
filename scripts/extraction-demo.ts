/**
 * Reading a passport, and refusing to read one that was never there.
 *
 *   pnpm run extraction-demo
 *
 * Two runs over the SAME document text.
 *
 *   1. An honest reader. Every value quotes a line of the passport, and each
 *      one is then put to the student for confirmation — because a document is
 *      not a confirmation (ADR-0016).
 *
 *   2. A confabulating reader, at confidence 1.0, producing perfectly
 *      passport-shaped values the document does not contain. Every reading is
 *      discarded before it can reach the student.
 *
 * A test driver, not a product surface (ADR-0015).
 */

import type { ModelText, ProposedValue } from "@askimate/aas-domain";
import {
  isFieldUnavailable,
  proposeValue,
  studentId,
  unwrapConfirmed,
  unwrapProposed,
} from "@askimate/aas-domain";
import type {
  DocumentRequest,
  ExtractionRequest,
  InterpretationRequest,
  ModelClient,
  NotUnderstood,
  QuestionRequest,
} from "@askimate/aas-llm";
import { demoModel, usageLine } from "./model-for-demo.js";
import { PASSPORT_TEXT, bytesOf } from "@askimate/aas-extraction/fixtures";
import {
  PlainTextExtractor,
  extractDocument,
  extracted,
  missingRequired,
  ungrounded,
} from "@askimate/aas-extraction";
import { FIELD_LABELS, emptyProfile, resolveField } from "@askimate/aas-profile";
import {
  newInterview,
  nextAction,
  receiveConfirmation,
  receiveExtractedValue,
} from "@askimate/aas-interview";

const DIM = "[2m";
const BOLD = "[1m";
const BLUE = "[36m";
const GREEN = "[32m";
const RED = "[31m";
const RESET = "[0m";

const NOW = new Date("2026-08-26T12:00:00Z");
const DOCUMENT_ID = "doc-passport-1";
const STUDENT = studentId("student-demo");

function rule(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}\n${DIM}${"─".repeat(72)}${RESET}`);
}

/** A model that returns confident, well-formed, entirely fabricated readings. */
class ConfabulatingModelClient implements ModelClient {
  public composeQuestion(_request: QuestionRequest): Promise<ModelText> {
    return Promise.reject(new Error("not used"));
  }
  public composeDocumentRequest(_request: DocumentRequest): Promise<ModelText> {
    return Promise.reject(new Error("not used"));
  }
  public interpretAnswer<T>(
    _request: InterpretationRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    return Promise.reject(new Error("not used"));
  }
  public extractFromDocument<T>(
    request: ExtractionRequest<T>,
  ): Promise<ProposedValue<T> | NotUnderstood> {
    const invented = /date|expir/.test(request.fieldKey) ? "01 JAN 2030" : "K99999999";
    const parsed = request.parse(invented);
    if (parsed === null) return Promise.resolve({ kind: "not_understood", reason: "n/a" });
    return Promise.resolve(
      proposeValue({
        value: parsed,
        origin: "document",
        verbatim: `${request.labels[0] ?? "Field"}: ${invented}`,
        confidence: 1,
        documentId: request.documentId,
      }),
    );
  }
}

function show(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
}

async function main(): Promise<void> {
  const demo = demoModel();
  console.log(`\n${demo.description}`);

  const extractor = new PlainTextExtractor();
  const text = await extractor.textOf({
    documentId: DOCUMENT_ID,
    documentType: "passport",
    contents: bytesOf(PASSPORT_TEXT),
  });

  rule("The document, as its text layer reads");
  console.log(
    DIM +
      PASSPORT_TEXT.split("\n")
        .map((line) => `  ${line}`)
        .join("\n") +
      RESET,
  );

  // ── 1. An honest reader ──────────────────────────────────────────────────
  rule("1 · An honest reader");

  // The honest reader is whatever was asked for: the stand-in, or a real model
  // through Bedrock. The confabulating one below is always fake, because the
  // point is to prove the guard catches invention — and a real model that
  // happened to be honest would prove nothing.
  const honest = await extractDocument(text, demo.client);
  if (honest === null) throw new Error("there is a plan for passports");

  for (const outcome of extracted(honest)) {
    const fields = unwrapProposed(outcome.proposed);
    console.log(
      `  ${GREEN}✓${RESET} ${outcome.targetKey.padEnd(34)} ${BOLD}${show(fields.value)}${RESET}`,
    );
    console.log(`    ${DIM}quoted from page ${String(outcome.page)}: "${fields.verbatim}"${RESET}`);
  }

  const missing = missingRequired(honest);
  console.log(
    `\n  ${
      missing.length === 0
        ? "No required target unread."
        : `Still to ask for: ${missing.join(", ")}`
    }`,
  );

  // ── 2. Extraction is not confirmation ────────────────────────────────────
  rule("2 · Extracted is not confirmed — the student still checks");

  let interview = newInterview({
    studentRef: STUDENT,
    profile: emptyProfile(STUDENT, NOW),
    requiredFields: ["identity.family_name"],
    requiredDocuments: [],
  });

  const familyName = extracted(honest).find(
    (outcome) => outcome.targetKey === "identity.family_name",
  );
  if (familyName === undefined) throw new Error("the fixture has a surname");

  console.log(`  ${DIM}Before confirmation, the profile has nothing:${RESET}`);
  const before = resolveField(interview.profile, "identity.family_name");
  console.log(
    `    ${FIELD_LABELS["identity.family_name"]}: ` +
      `${isFieldUnavailable(before) ? `${RED}unavailable — ${before.reason}${RESET}` : "?"}\n`,
  );

  interview = receiveExtractedValue(interview, "identity.family_name", familyName.proposed);
  const action = await nextAction(interview, demo.client);
  if (action.kind !== "confirm") throw new Error("expected a confirmation");
  console.log(`  ${BLUE}AskiMate${RESET}  ${action.say}`);
  console.log(`  ${BLUE}Student ${RESET}  Yes, that's right.\n`);

  const confirmed = receiveConfirmation(interview, { agreed: true }, NOW);
  interview = confirmed.state;
  const after = resolveField(interview.profile, "identity.family_name");
  if (isFieldUnavailable(after)) throw new Error("expected the value to be confirmed");
  console.log(
    `  ${GREEN}✓${RESET} now in the profile: ${BOLD}${unwrapConfirmed(after)}${RESET} ` +
      `${DIM}(document_extracted, ${DOCUMENT_ID})${RESET}`,
  );

  // ── 3. A confabulating reader ────────────────────────────────────────────
  rule("3 · A reader that invents, at confidence 1.0");

  const lying = await extractDocument(text, new ConfabulatingModelClient());
  if (lying === null) throw new Error("there is a plan for passports");

  for (const rejected of ungrounded(lying)) {
    console.log(
      `  ${RED}✗${RESET} ${rejected.targetKey.padEnd(34)} ${DIM}discarded${RESET}\n` +
        `    ${DIM}claimed: "${rejected.claimedSpan}" — not in the document${RESET}`,
    );
  }

  console.log(
    `\n  ${BOLD}${String(extracted(lying).length)}${RESET} readings accepted, ` +
      `${BOLD}${String(ungrounded(lying).length)}${RESET} discarded. ` +
      `${DIM}Nothing was shown to the student.${RESET}\n`,
  );

  console.log(`  ${DIM}Usage: ${RESET}${usageLine(demo)}\n`);
}

await main();
