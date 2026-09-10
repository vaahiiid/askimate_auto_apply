/**
 * The browser's side of this service's own API. Fetch calls, and nothing else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ADR-0060. Every function here is a call the published contract describes.
 * There is no derivation, no caching and no state: what the student sees comes
 * back from the server on every read, so a reload reconstructs the whole view
 * and the client never becomes a place workflow truth lives.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Relative URLs, deliberately ───────────────────────────────────────────
 *
 * Same origin as the page. The session is a `__Host-` cookie, which the
 * browser binds to exactly one origin with `Path=/` and no `Domain` — so a
 * client served from anywhere else would have no session at all. That is also
 * why this file configures no base URL, no CORS mode and no credentials mode:
 * there is one origin and the cookie goes with it.
 *
 * TWO exceptions, each cross-origin on purpose and each carrying no cookie.
 * `putDocument` (ADR-0092) sends a document's bytes to the bucket, on the URL
 * the declaration answered with, and the bucket is another origin.
 * `probeSecureOrigin` (ADR-0100) asks whether the secure plane answers at
 * all, before this page asks for a capability it could not use; it sends
 * nothing and reads nothing back. Those are the only absolute URLs this file
 * ever fetches.
 */

import type { ConversationEvent } from "@askimate/aas-contracts";
import {
  parseConversationEvent,
  parseConversationRun,
  parseProblem,
  parseRunPreview,
} from "@askimate/aas-contracts";
import type { ConversationRun, PriorOutcome, Problem, RunPreview } from "@askimate/aas-contracts";

/** One conversation, as `GET /v1/conversations` returns it. */
export interface Conversation {
  readonly id: string;
  readonly title: string | null;
  readonly createdAt: string;
  readonly lastOrdinal: number;
}

/** A reviewed target, as the listing returns it. Gate 1's output. */
export interface ApplicationTarget {
  readonly blueprintId: string;
  readonly institutionName: string;
  readonly campus?: string;
  readonly courseName: string;
  readonly intake: string;
  readonly intakeRef: string;
  readonly route: string;
  readonly portalHost: string;
  readonly requiredDocuments: readonly string[];
  readonly needsDisambiguation: boolean;
}

export interface TargetOffer {
  readonly offerHash: string;
  readonly rendered: string;
  readonly target: { readonly institutionName: string; readonly courseName: string };
}

/**
 * What the run is waiting for the student to do. ADR-0061.
 *
 * The hash is the SERVER's. This client never computes one: `confirm_handoff`
 * is over a message the orchestrator renders, and a client that hashed its own
 * would be hashing whatever it happened to display.
 */
export interface PendingDecision {
  readonly decision: "confirm_value" | "authorise" | "confirm_handoff";
  readonly contentHash: string;
}

export interface RunReading {
  readonly run: ConversationRun | null;
  readonly pending: PendingDecision | null;
}

/**
 * What a call did, without throwing. A refusal is an outcome, not an error.
 *
 * `problem` is the whole document when the contract's own parser accepted it,
 * and `null` otherwise. Some refusals carry MORE than a code — the one that
 * matters here is `already_applying`, whose `existingCaseId` and `concluded`
 * are on the wire for exactly one stated purpose: *"the refusal is otherwise a
 * dead end. 'You already have an application for this' is only useful if the
 * client can take the student to it, or — when it has concluded — offer them a
 * second attempt."* Until P42 this file threw both fields away.
 */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: string;
      readonly problem: Problem | null;
    };

async function refusal(
  response: Response,
): Promise<{ status: number; code: string; problem: Problem | null }> {
  // RFC 9457 everywhere on this service, so the code is where the reason is.
  const raw: unknown = await response.json().catch(() => null);
  // Read through the CONTRACT's parser rather than by hand: it is the same
  // reader the tests use, it refuses a code this client is older than, and it
  // is what makes an extension member trustworthy enough to act on. A document
  // it will not take still yields a code, because a refusal whose reason this
  // client cannot fully read is still a refusal and must not become a success.
  const problem = parseProblem(raw);
  const body = raw as { code?: unknown } | null;
  const code = problem?.code ?? (typeof body?.code === "string" ? body.code : "unknown");
  return { status: response.status, code, problem };
}

async function get<T>(path: string, read: (value: unknown) => T | null): Promise<Outcome<T>> {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) return { ok: false, ...(await refusal(response)) };
  const parsed = read(await response.json().catch(() => null));
  // A body the contract's own parser refuses is a failure, not something to
  // render around: the alternative is a screen built from a shape nobody
  // published.
  return parsed === null
    ? { ok: false, status: response.status, code: "contract_mismatch", problem: null }
    : { ok: true, value: parsed };
}

async function send<T>(
  path: string,
  body: unknown,
  read: (value: unknown) => T | null,
  headers: Readonly<Record<string, string>> = {},
): Promise<Outcome<T>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) return { ok: false, ...(await refusal(response)) };
  if (response.status === 204) return { ok: true, value: read(null) as T };
  const parsed = read(await response.json().catch(() => null));
  return parsed === null
    ? { ok: false, status: response.status, code: "contract_mismatch", problem: null }
    : { ok: true, value: parsed };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readConversation(value: unknown): Conversation | null {
  const row = asRecord(value);
  if (row === null || typeof row["id"] !== "string") return null;
  return {
    id: row["id"],
    title: typeof row["title"] === "string" ? row["title"] : null,
    createdAt: typeof row["createdAt"] === "string" ? row["createdAt"] : "",
    lastOrdinal: Number(row["lastOrdinal"] ?? 0),
  };
}

export function listConversations(): Promise<Outcome<readonly Conversation[]>> {
  return get("/v1/conversations?limit=50", (value) => {
    const body = asRecord(value);
    const rows = body?.["conversations"];
    if (!Array.isArray(rows)) return null;
    const parsed = rows.map(readConversation);
    return parsed.some((row) => row === null) ? null : (parsed as Conversation[]);
  });
}

export function openConversation(): Promise<Outcome<Conversation>> {
  // An Idempotency-Key, so a retried create returns the same conversation
  // rather than leaving an empty second one behind (ADR-0060).
  return send("/v1/conversations", null, readConversation, {
    "Idempotency-Key": `open-${crypto.randomUUID()}`,
  });
}

export function readEvents(conversationId: string): Promise<Outcome<readonly ConversationEvent[]>> {
  return get(`/v1/conversations/${conversationId}/events?limit=500`, (value) => {
    const rows = asRecord(value)?.["events"];
    if (!Array.isArray(rows)) return null;
    const parsed = rows.map((row) => parseConversationEvent(row));
    return parsed.some((row) => row === null) ? null : (parsed as ConversationEvent[]);
  });
}

/**
 * Where the run stands and what it is waiting for. ADR-0060, ADR-0061.
 *
 * The single most important call in this file: it is what makes a reload
 * correct. Nothing here is remembered between loads — not the run id, not the
 * step, not the offer hash — because this answers all three.
 */
export function readRun(conversationId: string): Promise<Outcome<RunReading>> {
  return get(`/v1/conversations/${conversationId}/runs`, (value) => {
    const body = asRecord(value);
    if (body === null || !("run" in body) || !("pending" in body)) return null;
    const run = body["run"] === null ? null : parseConversationRun(body["run"]);
    if (body["run"] !== null && run === null) return null;
    const raw = asRecord(body["pending"]);
    const pending =
      raw === null
        ? null
        : {
            decision: String(raw["decision"]) as PendingDecision["decision"],
            contentHash: String(raw["contentHash"]),
          };
    return { run, pending };
  });
}

export function readTargets(): Promise<Outcome<readonly ApplicationTarget[]>> {
  return get("/v1/application-targets", (value) => {
    const rows = asRecord(value)?.["targets"];
    return Array.isArray(rows) ? (rows as ApplicationTarget[]) : null;
  });
}

export function readPreview(
  conversationId: string,
  runId: string,
): Promise<Outcome<RunPreview>> {
  return get(`/v1/conversations/${conversationId}/runs/${runId}/preview`, parseRunPreview);
}

export function say(conversationId: string, content: string): Promise<Outcome<unknown>> {
  return send(
    `/v1/conversations/${conversationId}/messages`,
    { content },
    (value) => value ?? {},
    { "Idempotency-Key": `say-${crypto.randomUUID()}` },
  );
}

/** Gate 1: ask the server to put a reviewed target to the student. */
export function askForOffer(
  conversationId: string,
  blueprintId: string,
  disambiguated: boolean,
): Promise<Outcome<TargetOffer>> {
  return send(
    `/v1/conversations/${conversationId}/target-offers`,
    disambiguated ? { blueprintId, disambiguated: true } : { blueprintId },
    (value) => {
      const body = asRecord(value);
      return body === null || typeof body["offerHash"] !== "string"
        ? null
        : (body as unknown as TargetOffer);
    },
  );
}

/**
 * Gate 2: the student's explicit request, naming the offer they accepted.
 *
 * `studentStatement` is what they actually typed. It becomes the case's
 * request evidence, so "why did you apply to this for them?" is answerable
 * with their own sentence.
 */
export function requestApplication(
  conversationId: string,
  offerHash: string,
  studentStatement: string,
): Promise<Outcome<ConversationRun>> {
  return send(
    `/v1/conversations/${conversationId}/runs`,
    { offerHash, studentStatement },
    parseConversationRun,
  );
}

/**
 * The advice ADR-0006 rule 4 says must be SHOWN before an instruction is taken.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Two calls, and not as an accident of REST. The wait recommendation is
 * *"advisory in effect but MANDATORY in presentation: the system must show it
 * before accepting the instruction, and must record that it did"*. Collapsing
 * the pair into one would be building the thing the decision forbids, and the
 * server enforces the order — `reapply` is refused until the advice event is
 * in this conversation's log.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * What goes up is the OUTCOME and nothing else. The advice comes back composed
 * by the server from `recommendWait`, so there is no field through which this
 * client could claim to have shown advice it invented.
 */
export interface WaitAdviceReading {
  readonly priorCaseId: string;
  readonly advice: string;
  readonly suggestedIntake?: string;
  readonly rationale: string;
  readonly shownAt: string;
}

export function advisePriorOutcome(
  conversationId: string,
  priorOutcome: PriorOutcome,
): Promise<Outcome<WaitAdviceReading>> {
  return send(
    `/v1/conversations/${conversationId}/reapplication/prior-outcome`,
    { priorOutcome },
    (value) => {
      const body = asRecord(value);
      return body === null ||
        typeof body["advice"] !== "string" ||
        typeof body["rationale"] !== "string"
        ? null
        : (body as unknown as WaitAdviceReading);
    },
  );
}

/**
 * The instruction itself, in the student's own words.
 *
 * It carries the statement and NOTHING else — not the prior case, not the
 * attempt ordinal, not the outcome or the advice. Every one of those is a
 * field through which a client could disagree with the system about the one
 * number ADR-0006 exists to protect, and each is read back server-side from
 * the submission-key chain or from this conversation's own log.
 */
export function reapply(
  conversationId: string,
  studentStatement: string,
): Promise<Outcome<ConversationRun>> {
  return send(
    `/v1/conversations/${conversationId}/reapplication`,
    { studentStatement },
    // The document is a `ConversationRun` at the top level, as the contract
    // describes it — not wrapped, the way the runs route wraps its read.
    parseConversationRun,
  );
}

/**
 * A decision only the student can make.
 *
 * The hash is passed straight through from what the server said it wanted —
 * never recomputed here, and never taken from anything this client rendered.
 */
export function decide(
  conversationId: string,
  runId: string,
  decision: { readonly kind: string; readonly contentHash?: string },
): Promise<Outcome<unknown>> {
  return send(
    `/v1/conversations/${conversationId}/runs/${runId}/decision`,
    decision,
    (value) => value ?? {},
  );
}

export interface Bootstrap {
  readonly requestId: string;
  readonly frameToken: string;
  readonly secureOrigin: string;
}

/**
 * Where the secure plane is. A location and never a capability (ADR-0100):
 * the page reads this so it can decide whether it can show the step BEFORE
 * it asks for the bootstrap, which is the mint.
 */
export function readSecureOrigin(): Promise<Outcome<string>> {
  return get("/v1/secure-origin", (value) => {
    const origin = asRecord(value)?.["secureOrigin"];
    return typeof origin === "string" && origin !== "" ? origin : null;
  });
}

/**
 * Does the secure origin answer? The `endpointReachable` capability
 * (`decideRendering`), observed rather than assumed.
 *
 * `mode: "no-cors"`, so the answer is opaque: this page learns that the
 * request completed and nothing else — not the status, not a header, not a
 * byte of body. That is exactly the question. `credentials: "omit"` because
 * the secure plane's cookie is the frame's, never this page's, and a probe
 * that carried it would be a probe that could be made to spend it. A network
 * failure rejects, and a rejection is the only "no".
 */
export async function probeSecureOrigin(origin: string): Promise<boolean> {
  try {
    await fetch(`${origin}/healthz`, {
      mode: "no-cors",
      credentials: "omit",
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  }
}

export function bootstrapSecureStep(
  conversationId: string,
  requestId: string,
): Promise<Outcome<Bootstrap>> {
  return get(
    `/v1/conversations/${conversationId}/secure-requests/${requestId}/bootstrap`,
    (value) => {
      const body = asRecord(value);
      return body === null || typeof body["frameToken"] !== "string"
        ? null
        : (body as unknown as Bootstrap);
    },
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Documents (ADR-0090, ADR-0092, ADR-0093). Declare, PUT, confirm, re-read.
// ───────────────────────────────────────────────────────────────────────────

/** What the declaration answered: the upload to make, and the constraints, stated. */
export interface DeclaredUpload {
  readonly intakeId: string;
  readonly expiresAt: string;
  readonly upload: {
    readonly url: string;
    readonly method: "PUT";
    readonly headers: Readonly<Record<string, string>>;
    readonly expiresAt: string;
  };
  readonly maxBytes: number;
  readonly acceptedContentTypes: readonly string[];
  readonly contentHash: string;
  readonly retentionPolicyReference: string;
}

export interface HeldDocument {
  readonly documentId: string;
  readonly documentType: string;
  readonly state: string;
  readonly contentHash: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: string;
  readonly retentionPolicyReference: string;
}

export interface HeldDocuments {
  readonly documents: readonly HeldDocument[];
  readonly documentTypes: readonly string[];
}

function readHeldDocument(value: unknown): HeldDocument | null {
  const row = asRecord(value);
  if (row === null || typeof row["documentId"] !== "string" || typeof row["documentType"] !== "string") {
    return null;
  }
  return row as unknown as HeldDocument;
}

export function readDocuments(conversationId: string): Promise<Outcome<HeldDocuments>> {
  return get(`/v1/conversations/${conversationId}/documents`, (value) => {
    const body = asRecord(value);
    const rows = body?.["documents"];
    const types = body?.["documentTypes"];
    if (!Array.isArray(rows) || !Array.isArray(types)) return null;
    const parsed = rows.map(readHeldDocument);
    if (parsed.some((row) => row === null)) return null;
    return {
      documents: parsed as HeldDocument[],
      documentTypes: types.filter((t): t is string => typeof t === "string"),
    };
  });
}

/**
 * Step one of three. No purpose is sent: why the system holds a document is
 * the controller's decision per schedule row (ADR-0087), and the server
 * derives it. The hash IS sent, and it is the one hash this page computes —
 * see `journey.ts` for why that is the exception and not a crack in the rule.
 */
export function declareDocument(
  conversationId: string,
  declaration: {
    readonly documentType: string;
    readonly contentType: string;
    readonly contentHash: string;
    readonly sizeBytes: number;
  },
): Promise<Outcome<DeclaredUpload>> {
  return send(`/v1/conversations/${conversationId}/documents`, declaration, (value) => {
    const body = asRecord(value);
    const upload = asRecord(body?.["upload"]);
    return body === null ||
      typeof body["intakeId"] !== "string" ||
      upload === null ||
      typeof upload["url"] !== "string" ||
      upload["method"] !== "PUT" ||
      asRecord(upload["headers"]) === null
      ? null
      : (body as unknown as DeclaredUpload);
  });
}

/**
 * Step two: the bytes, STRAIGHT TO THE BUCKET. This service is not on the path
 * (ADR-0092) — which is why this is the one call in this file that is not to a
 * relative URL, and the one whose target is cross-origin. The headers are sent
 * exactly as given: the URL's signature covers them, and the bucket refuses
 * the PUT if any is missing or altered (ADR-0092 §4, E6 and E7). No cookie
 * goes with it: the bucket has no session, and `credentials` is left at its
 * default of same-origin so none is offered.
 *
 * Not an `Outcome`: the bucket answers no problem document, so there is no
 * code to word. The status is enough for the page to say what happened.
 */
export async function putDocument(
  upload: DeclaredUpload["upload"],
  bytes: Blob,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly status: number }> {
  try {
    const response = await fetch(upload.url, {
      method: upload.method,
      headers: upload.headers,
      body: bytes,
      mode: "cors",
    });
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch {
    // A preflight the bucket refused, or no network. The browser reports
    // both as a TypeError with no status; 0 is the conventional "no answer".
    return { ok: false, status: 0 };
  }
}

/** Step three: ask the server to ask the bucket. The page's word is not taken. */
export function confirmDocument(
  conversationId: string,
  intakeId: string,
): Promise<Outcome<HeldDocument>> {
  return send(
    `/v1/conversations/${conversationId}/documents/${intakeId}/confirm`,
    null,
    readHeldDocument,
  );
}
