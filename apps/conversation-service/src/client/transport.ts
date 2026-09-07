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
