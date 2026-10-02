/**
 * The CV reader's contract with the Application Plane (ADR-0148 §9, ADR-0149,
 * ADR-0092 as amended: the second process that fetches a document).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Three messages, none of which carries the document.
 *
 *   claim    the reader asks for a document to read; the plane answers with a
 *            lease and a SIXTY-SECOND retrieval URL, minted after the storage
 *            gate — the reader holds a URL, never a key, exactly as the runner
 *            does (ADR-0042 kept).
 *   report   the reader says what the document GAVE: for each list, each entry
 *            as the parts the document stated (parsed, with the span each was
 *            read from) and the parts it did not, which the interview asks.
 *            A part marked as the student's to state is never in a report,
 *            because it was never asked of the document (ADR-0149).
 *
 * What crosses is what the interview would have held had the student typed
 * it: a value and the words it came from. Nothing else of the document —
 * not a line, not a page — is on this contract, and the plane's parser
 * refuses a report that tries.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const READING_OUTCOMES = ["read", "failed"] as const;
export type ReadingOutcome = (typeof READING_OUTCOMES)[number];

/**
 * Why a reading did not happen. A closed set: the reader has no words of its
 * own on this contract, and none of these carries anything of the document.
 *
 *   retrieval_failed   the sixty-second GET did not answer 200
 *   content_changed    the bytes fetched do not hash to what the plane said
 *   unreadable         no text could be read out of the bytes (no text layer, not a .docx)
 *   model_unavailable  the model could not be called, or refused every call
 *   reader_fault       the reader threw; nothing is known about what it managed
 */
export const READING_FAILURES = ["retrieval_failed", "content_changed", "unreadable", "model_unavailable", "reader_fault"] as const;
export type ReadingFailure = (typeof READING_FAILURES)[number];

/**
 * The profile fields a CV fills (P251): the list targets of the extraction
 * package's CV plan, named here so the plane can ask before any reading —
 * *"I have your CV. Do you want me to fill in your jobs and qualifications
 * from it…"* — when the interview reaches the first of them, and defer them
 * while the reader works. The extraction package's test holds its plan to
 * this list, so the two cannot drift apart unnoticed.
 */
export const CV_LIST_FIELDS = ["employment.history", "education.prior_qualifications"] as const;

export const MAX_LISTS_PER_READING = 8;
export const MAX_ENTRIES_PER_LIST = 50;
export const MAX_PARTS_PER_ENTRY = 24;
/** A part's words: a line or a few of a CV, never a page. */
export const MAX_SPAN_LENGTH = 4_000;
export const MAX_FIELD_TEXT_LENGTH = 4_000;

const FIELD_KEY = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const PART_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,31}$/;

export interface ClaimReadingRequest {
  readonly holder: string;
  readonly leaseSeconds?: number;
}

export interface ClaimedReading {
  readonly leaseId: string;
  /** When the lease lapses and the document becomes claimable again. RFC 3339. */
  readonly expiresAt: string;
  readonly documentId: string;
  /** The conversation the document was sent in — whose interview the reading seeds. */
  readonly conversationId: string;
  readonly documentType: string;
  readonly contentType: string;
  /** SHA-256, lowercase hex. The reader hashes what it fetched and refuses a mismatch. */
  readonly contentHash: string;
  /** A short-lived GET the plane minted after the gate. The reader fetches it once. */
  readonly retrieval: {
    readonly url: string;
    readonly method: "GET";
    /** RFC 3339. */
    readonly expiresAt: string;
  };
}

/**
 * A part's value as the profile holds it: text, a number, a yes/no, or a
 * small structure (a month and a year; a job's end). Bounded in depth and
 * size, so the report cannot smuggle a document through a value.
 */
export type WireFieldValue = string | number | boolean | { readonly [key: string]: WireFieldValue };

export interface WireEntryReading {
  /** One-based, in document order. */
  readonly index: number;
  /** Every `document` part the document stated, parsed, by part key. */
  readonly fields: Readonly<Record<string, WireFieldValue>>;
  /** The span each field was read from, by the same key — the student's own words for the playback. */
  readonly spans: Readonly<Record<string, string>>;
  /** The lowest confidence among the parts read, 0 to 1. */
  readonly confidence: number;
  /** The parts the interview asks: missing from the document, read but not that value, read in part, or the student's to state. In the plan's order. */
  readonly toAsk: readonly string[];
  /**
   * Which of `toAsk` are the student's to state (ADR-0149) — never asked of
   * the document, so not "things it did not say" (P248). Vahid: *"a student
   * reading the first version would think their CV was deficient for not
   * stating whether a job was full-time. It is not — we never asked it to."*
   */
  readonly student: readonly string[];
  /**
   * Parts read IN PART (P248): the components the document gave and the ones
   * the interview asks — a year without its month. Each is in `toAsk`, not in
   * `fields`, and has its words in `spans`, so the question can say what the
   * document gave. Absent when none.
   */
  readonly partial?: Readonly<Record<string, WirePartialReading>>;
  /**
   * The words most of the entry's parts came back as (P266): the line, not
   * its parts. Present only on an entry with no field, no span and nothing
   * read in part — nothing of it is taken, and the interview asks it by hand,
   * showing these words. Absent on a reading.
   */
  readonly unreadable?: string;
}

export interface WirePartialReading {
  readonly have: Readonly<Record<string, WireFieldValue>>;
  readonly lacking: readonly string[];
}

export interface WireListReading {
  /** The profile field the list fills, e.g. `employment.history`. */
  readonly fieldKey: string;
  readonly entries: readonly WireEntryReading[];
  /** Entries the reader cut and does not offer: an invented span, or two date ranges cut as one. A count; the log has no words for them. */
  readonly dropped: number;
}

export interface ReadingReport {
  readonly leaseId: string;
  readonly outcome: ReadingOutcome;
  /** Present exactly when the outcome is `failed`. */
  readonly failure?: ReadingFailure;
  /** Present exactly when the outcome is `read`. */
  readonly lists?: readonly WireListReading[];
  /** The provider's own figures for the calls this reading made, when the reader has them. */
  readonly usage?: {
    readonly calls: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isMember<T extends string>(members: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (members as readonly string[]).includes(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parseClaimedReading(value: unknown): ClaimedReading | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const field of ["leaseId", "expiresAt", "documentId", "conversationId", "documentType", "contentType", "contentHash"]) {
    if (!nonEmpty(record[field])) return null;
  }
  if (!/^[0-9a-f]{64}$/.test(record["contentHash"] as string)) return null;
  const retrieval = record["retrieval"];
  if (typeof retrieval !== "object" || retrieval === null) return null;
  const r = retrieval as Record<string, unknown>;
  if (!nonEmpty(r["url"]) || r["method"] !== "GET" || !nonEmpty(r["expiresAt"])) return null;
  if (!r["url"].startsWith("https://") && !r["url"].startsWith("http://127.0.0.1")) return null;
  return {
    leaseId: record["leaseId"] as string,
    expiresAt: record["expiresAt"] as string,
    documentId: record["documentId"] as string,
    conversationId: record["conversationId"] as string,
    documentType: record["documentType"] as string,
    contentType: record["contentType"] as string,
    contentHash: record["contentHash"] as string,
    retrieval: { url: r["url"], method: "GET", expiresAt: r["expiresAt"] },
  };
}

/** A value as the profile holds it, bounded: text, a number, a yes/no, or a small structure of them. */
function parseFieldValue(value: unknown, depth: number): WireFieldValue | null {
  if (typeof value === "string") return value.length <= MAX_FIELD_TEXT_LENGTH ? value : null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (typeof value !== "object" || value === null || Array.isArray(value) || depth >= 3) return null;
  const out: Record<string, WireFieldValue> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 8) return null;
  for (const [key, inner] of entries) {
    if (!PART_KEY.test(key)) return null;
    const parsed = parseFieldValue(inner, depth + 1);
    if (parsed === null) return null;
    out[key] = parsed;
  }
  return out;
}

function parseEntry(value: unknown): WireEntryReading | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const index = record["index"];
  if (!isCount(index) || index < 1 || index > MAX_ENTRIES_PER_LIST) return null;
  const confidence = record["confidence"];
  if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1)) return null;

  const rawFields = record["fields"];
  const rawSpans = record["spans"];
  if (typeof rawFields !== "object" || rawFields === null || Array.isArray(rawFields)) return null;
  if (typeof rawSpans !== "object" || rawSpans === null || Array.isArray(rawSpans)) return null;
  const fields: Record<string, WireFieldValue> = {};
  const fieldEntries = Object.entries(rawFields as Record<string, unknown>);
  if (fieldEntries.length > MAX_PARTS_PER_ENTRY) return null;
  for (const [key, inner] of fieldEntries) {
    if (!PART_KEY.test(key)) return null;
    const parsed = parseFieldValue(inner, 0);
    if (parsed === null) return null;
    fields[key] = parsed;
  }
  const toAsk = record["toAsk"];
  if (!Array.isArray(toAsk) || toAsk.length > MAX_PARTS_PER_ENTRY) return null;
  if (!toAsk.every((key) => isString(key) && PART_KEY.test(key))) return null;
  if (toAsk.some((key) => key in fields)) return null;
  const asked = new Set(toAsk as string[]);

  // The student's parts are among those asked (P248): a part both the
  // document's and the student's is a contradiction, as is one nobody asks.
  const student = record["student"];
  if (!Array.isArray(student) || student.length > MAX_PARTS_PER_ENTRY) return null;
  if (!student.every((key) => isString(key) && asked.has(key))) return null;

  // A part read in part is asked, is not a field, gives something and lacks
  // something — else it would be a value, or a missing part.
  const partial: Record<string, WirePartialReading> = {};
  const rawPartial = record["partial"];
  if (rawPartial !== undefined) {
    if (typeof rawPartial !== "object" || rawPartial === null || Array.isArray(rawPartial)) return null;
    for (const [key, inner] of Object.entries(rawPartial as Record<string, unknown>)) {
      if (!asked.has(key) || key in fields) return null;
      const parsed = parsePartial(inner);
      if (parsed === null) return null;
      partial[key] = parsed;
    }
  }

  const spans: Record<string, string> = {};
  for (const [key, span] of Object.entries(rawSpans as Record<string, unknown>)) {
    // A span names a part that was read, whole or in part: words without a
    // value would be document text with nothing to be the words OF.
    if (!(key in fields) && !(key in partial)) return null;
    if (!isString(span) || span.length === 0 || span.length > MAX_SPAN_LENGTH) return null;
    spans[key] = span;
  }
  // Every part read carries its words: a value with no span is a value the
  // student cannot be shown the source of, which the playback needs; a part
  // read in part with no span is a question that cannot say what it read.
  for (const key of [...Object.keys(fields), ...Object.keys(partial)]) if (!(key in spans)) return null;

  // P266: an entry whose parts came back as one span carries those words and
  // nothing taken from them. Words beside a value would be the contradiction
  // the detector exists to catch.
  const unreadable = record["unreadable"];
  if (unreadable !== undefined) {
    if (!isString(unreadable) || unreadable.length === 0 || unreadable.length > MAX_SPAN_LENGTH) return null;
    if (Object.keys(fields).length > 0 || Object.keys(spans).length > 0 || Object.keys(partial).length > 0) return null;
  }

  return {
    index,
    fields,
    spans,
    confidence,
    toAsk: toAsk as string[],
    student: student as string[],
    ...(Object.keys(partial).length === 0 ? {} : { partial }),
    ...(unreadable === undefined ? {} : { unreadable }),
  };
}

function parsePartial(value: unknown): WirePartialReading | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawHave = record["have"];
  if (typeof rawHave !== "object" || rawHave === null || Array.isArray(rawHave)) return null;
  const have: Record<string, WireFieldValue> = {};
  const entries = Object.entries(rawHave as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_PARTS_PER_ENTRY) return null;
  for (const [key, inner] of entries) {
    if (!PART_KEY.test(key)) return null;
    const parsed = parseFieldValue(inner, 0);
    if (parsed === null) return null;
    have[key] = parsed;
  }
  const lacking = record["lacking"];
  if (!Array.isArray(lacking) || lacking.length === 0 || lacking.length > MAX_PARTS_PER_ENTRY) return null;
  if (!lacking.every((key) => isString(key) && PART_KEY.test(key) && !(key in have))) return null;
  return { have, lacking: lacking as string[] };
}

function parseList(value: unknown): WireListReading | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isString(record["fieldKey"]) || !FIELD_KEY.test(record["fieldKey"]) || record["fieldKey"].length > 64) return null;
  const rawEntries = record["entries"];
  if (!Array.isArray(rawEntries) || rawEntries.length > MAX_ENTRIES_PER_LIST) return null;
  const entries: WireEntryReading[] = [];
  const seen = new Set<number>();
  for (const raw of rawEntries) {
    const entry = parseEntry(raw);
    if (entry === null || seen.has(entry.index)) return null;
    seen.add(entry.index);
    entries.push(entry);
  }
  const dropped = record["dropped"];
  if (!isCount(dropped) || dropped > MAX_ENTRIES_PER_LIST) return null;
  return { fieldKey: record["fieldKey"], entries, dropped };
}

export function parseReadingReport(value: unknown): ReadingReport | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!nonEmpty(record["leaseId"])) return null;
  if (!isMember(READING_OUTCOMES, record["outcome"])) return null;
  const outcome = record["outcome"];

  let usage: ReadingReport["usage"];
  const rawUsage = record["usage"];
  if (rawUsage !== undefined) {
    if (typeof rawUsage !== "object" || rawUsage === null) return null;
    const u = rawUsage as Record<string, unknown>;
    if (!isCount(u["calls"]) || !isCount(u["inputTokens"]) || !isCount(u["outputTokens"])) return null;
    usage = { calls: u["calls"], inputTokens: u["inputTokens"], outputTokens: u["outputTokens"] };
  }

  // Symmetric, as the runner's report is: a `read` with a failure and a
  // `failed` with lists are both records that read as more than happened.
  if (outcome === "read") {
    if (record["failure"] !== undefined) return null;
    const rawLists = record["lists"];
    if (!Array.isArray(rawLists) || rawLists.length > MAX_LISTS_PER_READING) return null;
    const lists: WireListReading[] = [];
    const seen = new Set<string>();
    for (const raw of rawLists) {
      const list = parseList(raw);
      if (list === null || seen.has(list.fieldKey)) return null;
      seen.add(list.fieldKey);
      lists.push(list);
    }
    return { leaseId: record["leaseId"], outcome, lists, ...(usage === undefined ? {} : { usage }) };
  }
  if (!isMember(READING_FAILURES, record["failure"])) return null;
  if (record["lists"] !== undefined) return null;
  return { leaseId: record["leaseId"], outcome, failure: record["failure"], ...(usage === undefined ? {} : { usage }) };
}
