/**
 * The SSE transport, and resumability by ordinal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * Vahid, 2026-08-28: *"Define SSE transport and resumability using
 * Last-Event-ID / event ordinals."*
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Why the ordinal IS the event id ───────────────────────────────────────
 *
 * SSE has resumption built in: a client that drops sends `Last-Event-ID` on
 * reconnect, carrying the last `id:` it saw. Because the conversation log is
 * append-only with dense, per-conversation ordinals (ADR-0031), that field maps
 * onto our data model with nothing in between — no cursor table, no opaque
 * token, no bookkeeping that can disagree with the log.
 *
 * `Last-Event-ID: 41` means exactly `WHERE ordinal > 41 ORDER BY ordinal`.
 *
 * ── Why a resume is not a security decision ───────────────────────────────
 *
 * `Last-Event-ID` is client-supplied, so it is parsed as an untrusted integer
 * and then used ONLY as a lower bound within a conversation the caller has
 * already been authorised for. A hostile value cannot widen the query: a
 * negative or absurd number is refused, and authorisation happened before this
 * value was read.
 */

import type { ConversationEvent, Ordinal } from "./events.js";

/** The SSE `event:` field. One kind of frame carries data; two do not. */
export const SSE_EVENT_NAME = "conversation.event";

/**
 * Sent immediately on connect, before any event.
 *
 * Tells the client which ordinal the stream is resuming from, so it can detect
 * a gap between what it holds and what the stream will send — and backfill over
 * the paged endpoint rather than silently rendering a conversation with a hole.
 */
export const SSE_RESUME_EVENT_NAME = "conversation.resume";

/**
 * A comment line, every 15 seconds.
 *
 * Not a protocol requirement — a practical one. Idle connections are reaped by
 * proxies and load balancers that see no bytes, and a stream that dies silently
 * looks to a student exactly like a conversation that stopped working.
 */
export const SSE_HEARTBEAT_INTERVAL_MS = 15_000;
export const SSE_HEARTBEAT_LINE = ": keep-alive";

/** What the server sends on connect. */
export interface SseResumeFrame {
  readonly resumingAfter: Ordinal;
}

/**
 * Renders one event as an SSE frame.
 *
 * `id:` is the ordinal, which is what makes `Last-Event-ID` work. The payload is
 * a `ConversationEvent` and therefore cannot contain a secret: only `message`
 * carries free text, and a secure event has no field to put one in.
 */
export function renderSseFrame(event: ConversationEvent): string {
  return [
    `id: ${String(event.ordinal)}`,
    `event: ${SSE_EVENT_NAME}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}

export function renderSseResumeFrame(frame: SseResumeFrame): string {
  return [
    `event: ${SSE_RESUME_EVENT_NAME}`,
    `data: ${JSON.stringify(frame)}`,
    "",
    "",
  ].join("\n");
}

/**
 * Reads `Last-Event-ID` into a lower bound, or refuses it.
 *
 * Absent header, empty string, non-integer, negative, or beyond the safe
 * integer range → `null`, meaning "start from the beginning". A malformed
 * resume must not become a silent `0`, and it must not become a query the
 * caller did not intend: this returns a bound, and the caller applies it to a
 * conversation it has already authorised.
 */
export function parseLastEventId(header: string | null | undefined): Ordinal | null {
  if (typeof header !== "string") return null;
  const trimmed = header.trim();
  if (trimmed.length === 0) return null;
  // Deliberately strict: `parseInt` accepts "41abc" and " 41 " and "0x29".
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

/**
 * The headers a compliant stream must carry.
 *
 * `X-Accel-Buffering: no` is not decorative: a buffering reverse proxy holds an
 * SSE response until its buffer fills, which turns a live stream into a stream
 * that delivers everything at once, minutes late, and looks like a bug in the
 * application.
 */
export const SSE_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-store",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
