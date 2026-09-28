/**
 * One document, read and forgotten (ADR-0148 §9, ADR-0149).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Fetch the bytes through the URL the plane minted; refuse them unless they
 * hash to what the plane said; turn them into text through the real PDF or
 * Word library; cut each list through the model and read each entry's
 * document parts; report what the document gave and what it did not. Then
 * nothing is kept: the bytes, the text and the readings live in this
 * function's frame and go with it.
 *
 * What the report carries is what the interview would have held had the
 * student typed it — a value and the words it came from — and never a line
 * of the document beyond those words. A part that is the student's to state
 * is never asked of the document, and is named in `toAsk` so the interview
 * asks it (ADR-0149).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from "node:crypto";

import type { ClaimedReading, ReadingFailure, ReadingReport, WireEntryReading, WireFieldValue, WireListReading } from "@askimate/aas-contracts";
import { planFor, readListEntries, textExtractorFor } from "@askimate/aas-extraction";
import type { ListReading } from "@askimate/aas-extraction";
import type { ModelClient } from "@askimate/aas-llm";
import { BedrockModelClient } from "@askimate/aas-llm";

export interface ReadDocumentOptions {
  readonly claim: ClaimedReading;
  readonly model: ModelClient;
  readonly fetch?: typeof globalThis.fetch;
}

/** A reading of a list, as the contract carries it: each standing entry's fields, words and what is left to ask. */
export function readingOf(reading: ListReading, parts: readonly { readonly partKey: string }[]): WireListReading {
  const order = parts.map((part) => part.partKey);
  const entries: WireEntryReading[] = reading.entries
    .filter((entry) => entry.dropped === null)
    .map((entry) => ({
      index: entry.index,
      fields: entry.fields as Record<string, WireFieldValue>,
      spans: entry.spans,
      confidence: entry.lowestConfidence,
      toAsk: order.filter((key) => entry.parts.some((part) => part.partKey === key && (part.status === "missing" || part.status === "unparsed" || part.status === "student"))),
    }));
  return {
    fieldKey: reading.fieldKey,
    entries,
    dropped: reading.entries.filter((entry) => entry.dropped !== null).length,
  };
}

function failed(leaseId: string, failure: ReadingFailure, usage?: ReadingReport["usage"]): ReadingReport {
  return { leaseId, outcome: "failed", failure, ...(usage === undefined ? {} : { usage }) };
}

function usageOf(model: ModelClient): ReadingReport["usage"] | undefined {
  if (!(model instanceof BedrockModelClient)) return undefined;
  const usage = model.usage;
  return { calls: usage.calls, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

export async function readDocument(options: ReadDocumentOptions): Promise<ReadingReport> {
  const { claim } = options;
  const doFetch = options.fetch ?? globalThis.fetch;

  let response: Response;
  try {
    response = await doFetch(claim.retrieval.url, { method: claim.retrieval.method });
  } catch {
    return failed(claim.leaseId, "retrieval_failed");
  }
  if (!response.ok) return failed(claim.leaseId, "retrieval_failed");
  const contents = new Uint8Array(await response.arrayBuffer());
  // The bytes are the ones the plane said, or they are nobody's.
  if (createHash("sha256").update(contents).digest("hex") !== claim.contentHash) {
    return failed(claim.leaseId, "content_changed");
  }

  const extractor = textExtractorFor(claim.contentType);
  if (extractor === undefined || claim.documentType !== "cv") return failed(claim.leaseId, "unreadable");
  const plan = planFor("cv");
  if (plan === undefined) return failed(claim.leaseId, "unreadable");

  let text;
  try {
    text = await extractor.textOf({ documentId: claim.documentId, documentType: "cv", contents });
  } catch {
    return failed(claim.leaseId, "unreadable");
  }

  const lists: WireListReading[] = [];
  try {
    for (const target of plan.targets) {
      if (target.kind !== "list") continue;
      const reading = await readListEntries(target, text, options.model);
      lists.push(readingOf(reading, target.parts));
    }
  } catch {
    // The model could not be called, or refused; nothing partial is reported,
    // because a half-read CV seeded into an interview would ask the student
    // for jobs the document lists.
    return failed(claim.leaseId, "model_unavailable", usageOf(options.model));
  }

  const usage = usageOf(options.model);
  return { leaseId: claim.leaseId, outcome: "read", lists, ...(usage === undefined ? {} : { usage }) };
}
